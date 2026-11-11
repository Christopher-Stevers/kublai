// Production React primitive fixture; actual Chromium touch input, no app writes.
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
const require = createRequire(import.meta.url),
  esbuild = createRequire(require.resolve("tsx"))("esbuild");
const feedback = process.env.PRESS_FEEDBACK ?? "state";
if (feedback !== "state" && feedback !== "attribute") throw Error("PRESS_FEEDBACK must be state or attribute");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const sourceFiles = ["perf/press/run.mjs", "perf/press/fixture.tsx", "src/hooks/use-press.ts", "src/components/ui/button.tsx", "src/components/ui/pressable-card.tsx", "src/components/ui/card.tsx", "src/lib/utils.ts", "pnpm-lock.yaml"];
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, sha(await readFile(file))])));
const startedAt = new Date().toISOString();
const temp = await mkdtemp(path.join(tmpdir(), "press-fixture-"));
let browser, server;
try {
  await esbuild.build({
    entryPoints: ["perf/press/fixture.tsx"],
    outfile: path.join(temp, "app.js"),
    bundle: true,
    format: "esm",
    jsx: "automatic",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "~": path.resolve("src") },
  });
  server = http.createServer(async (req, res) => {
    if (req.url === "/app.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(await readFile(path.join(temp, "app.js")));
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/app.js"></script>',
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/?feedback=${feedback}`);
  await page.locator("#fixed").waitFor();
  const cdp = await context.newCDPSession(page);
  await page.locator("#fixed").tap();
  assert.equal((await page.evaluate(() => window.pressResult)).fixed, 1);
  await page.locator("#fixed").focus();
  await page.keyboard.press("Enter");
  assert.equal((await page.evaluate(() => window.pressResult)).fixed, 2);
  const send = await page.locator("#write").boundingBox();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: send.x + 10, y: send.y + 10 }],
  });
  assert.equal((await page.evaluate(() => window.pressResult)).writes, 0);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.waitForFunction(() => window.pressResult.writes === 1);
  for (let i = 0; i < 200; i++) {
    await page.evaluate(() => (document.querySelector("#rows").scrollTop = 0));
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 160, y: 490 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 160, y: 430 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 160, y: 350 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  const result = await page.evaluate(() => window.pressResult);
  assert.equal(result.opens, 0);
  assert.equal(result.writes, 1);
  assert.equal(result.fixed, 2);
  assert.ok(result.prepared >= 200);
  assert.ok(result.cancelled >= 200);
  assert.equal(await page.locator('#rows [data-pressed="true"]').count(), 0);
  for (const file of sourceFiles) assert.equal(sha(await readFile(file)), sourceHashes[file], `Source changed while testing: ${file}`);
  console.log(
    JSON.stringify({
      version: 1,
      feedback,
      fixtureQuery: `?feedback=${feedback}`,
      provenance: "isolated-production-react-primitives",
      browser: "Chromium desktop touch emulation",
      flings: 200,
      ...result,
      phoneOrAppLatencyEvidence: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      sourceHashes,
      sourceUnchanged: true,
      toolchain: { node: process.version, esbuild: esbuild.version, playwright: require("@playwright/test/package.json").version, chromium: browser.version() },
      bundleSha256: sha(await readFile(path.join(temp, "app.js"))),
    }),
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
