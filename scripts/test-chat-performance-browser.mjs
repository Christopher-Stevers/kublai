import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { chromium, expect } from "@playwright/test";
const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve("tsx"))("esbuild");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "foremanhq-chat-browser-"));
await esbuild.build({
  entryPoints: ["scripts/fixtures/chat-performance/app.jsx"],
  outfile: path.join(temp, "app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
const server = http.createServer((req, res) => {
  if (req.url === "/app.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(fs.readFileSync(path.join(temp, "app.js")));
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font:16px sans-serif}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
    );
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const errors = [];
try {
  for (const [width, count] of [
    [390, 600],
    [1280, 600],
    [390, 100],
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    await page.goto(`http://127.0.0.1:${server.address().port}?count=${count}`);
    await expect(
      page.locator(`[data-chat-message-id="${count - 1}"]`),
    ).toBeVisible();
    if (count > 100)
      await expect.poll(() => page.locator("article").count()).toBeLessThan(50);
    await page.locator("#timeline").evaluate((el) => {
      el.scrollTop = el.scrollHeight * 0.4;
    });
    const anchor = () =>
      page.evaluate(() => {
        const viewport = document
          .querySelector("#timeline")
          .getBoundingClientRect();
        const item = [...document.querySelectorAll("article")].find(
          (el) => el.getBoundingClientRect().bottom > viewport.top + 1,
        );
        return {
          id: item?.dataset.chatMessageId,
          offset: item?.getBoundingClientRect().top - viewport.top,
        };
      });
    await page.waitForTimeout(200);
    const before = await anchor();
    await page.evaluate(() => window.prepend());
    await expect.poll(async () => (await anchor()).id).toBe(before.id);
    await expect
      .poll(async () => Math.abs((await anchor()).offset - before.offset))
      .toBeLessThan(3);
    await page.evaluate(() => window.append());
    await expect.poll(async () => (await anchor()).id).toBe(before.id);
    const prior = await page.evaluate((id) => {
      const items = [...document.querySelectorAll("article")];
      return items[items.findIndex((el) => el.dataset.chatMessageId === id) - 1]
        ?.dataset.chatMessageId;
    }, before.id);
    if (prior) {
      await page.evaluate((id) => window.grow(id), prior);
      await expect.poll(async () => (await anchor()).id).toBe(before.id);
      await expect
        .poll(async () => Math.abs((await anchor()).offset - before.offset))
        .toBeLessThan(3);
    }
    const saved = await anchor();
    await page.evaluate(() => window.hideChat());
    await expect(page.locator("#timeline")).toHaveCount(0);
    await page.evaluate(() => window.showChat());
    await expect.poll(async () => (await anchor()).id).toBe(saved.id);
    await expect
      .poll(async () => Math.abs((await anchor()).offset - saved.offset))
      .toBeLessThan(3);
    // User scrolling ends restoration's temporary image-resize following.
    await page.locator("#timeline").dispatchEvent("wheel");
    await page.locator("#timeline").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(
      page.locator(`[data-chat-message-id="${count}"]`),
    ).toBeVisible();
    await page.evaluate(() => window.append());
    await expect(
      page.locator(`[data-chat-message-id="${count + 1}"]`),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator("#timeline")
          .evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
      )
      .toBeLessThan(3);
    await expect.poll(() => page.locator("article").count()).toBeLessThan(50);
    console.log(
      JSON.stringify({
        width,
        totalMessages: count + 52,
        mounted: await page.locator("article").count(),
        prependAndResizeAnchor: "preserved",
      }),
    );
    await page.close();
  }
  expect(errors).toEqual([]);
} finally {
  await browser.close();
  server.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
