// @ts-nocheck
// Real Three.js + IFC worker and touch input. All API writes use local fixtures.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { chromium, expect } from "@playwright/test";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { blankCadIfc } from "../src/lib/bim/blank-cad.ts";
const require = createRequire(import.meta.url),
  esbuild = createRequire(require.resolve("tsx"))("esbuild");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "foremanhq-cad-browser-"));
const screenshots = path.resolve(process.env.CAD_SCREENSHOTS ?? ".tmp/cad-qa");
fs.mkdirSync(screenshots, { recursive: true });
await esbuild.build({
  entryPoints: ["scripts/fixtures/cad/app.jsx"],
  outfile: path.join(temp, "app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "fixtures",
      setup(build) {
        build.onResolve(
          { filter: /^(~\/trpc\/react|\.\/use-model-scene)$/ },
          (args) => ({
            path: path.resolve(
              "scripts/fixtures/cad",
              args.path === "~/trpc/react" ? "api.js" : "scene.js",
            ),
          }),
        );
      },
    },
  ],
});
await esbuild.build({
  entryPoints: ["src/lib/bim/ifc.worker.ts"],
  outfile: path.join(temp, "worker.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
});
const css = await postcss([tailwind()]).process(
  fs.readFileSync("src/styles/globals.css", "utf8"),
  { from: "src/styles/globals.css" },
);
const routes = {
  "/app.js": path.join(temp, "app.js"),
  "/lib/bim/ifc.worker.ts": path.join(temp, "worker.js"),
  "/api/models/wasm/web-ifc.wasm": path.join(
    path.dirname(require.resolve("web-ifc")),
    "web-ifc.wasm",
  ),
  "/api/models/files/10000000-0000-4000-8000-000000000001":
    "src/lib/bim/fixtures/construction.ifc",
};
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost"),
    file = routes[u.pathname];
  if (file) {
    res.setHeader(
      "Content-Type",
      u.pathname.endsWith(".wasm")
        ? "application/wasm"
        : u.pathname.endsWith(".js") || u.pathname.endsWith(".ts")
          ? "text/javascript"
          : "application/octet-stream",
    );
    res.setHeader("Content-Length", fs.statSync(file).size);
    res.end(req.method === "HEAD" ? undefined : fs.readFileSync(file));
    return;
  }
  if (u.pathname.startsWith("/api/models/files/")) {
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", Buffer.byteLength(blankCadIfc));
    res.end(req.method === "HEAD" ? undefined : blankCadIfc);
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
      css.css +
      '</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = "http://127.0.0.1:" + server.address().port;
const executablePath =
  process.env.CAD_CHROMIUM ??
  (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
});
async function open(page) {
  await page.goto(url);
  await page
    .getByRole("checkbox", { name: "Open Architecture version 1" })
    .click();
  await page.waitForFunction(
    () => window.test?.ready && window.test.elements.length > 0,
    null,
    { timeout: 30000 },
  );
  const close = page.getByRole("button", { name: "Close panel", exact: true });
  if (await close.isVisible()) await close.click();
  await page.getByRole("button", { name: "Edit model", exact: true }).click();
}
async function save(page) {
  await page.getByRole("button", { name: "Save design", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save design", exact: true }),
  ).toBeDisabled();
}
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await expect(page.locator("[data-cad-view]:visible")).toHaveCount(4);
  await page.getByRole("button", { name: "Top view", exact: true }).click();
  await page.getByLabel("Add model element").selectOption("pipe");
  const rect = await page.locator("[data-cad-view=top]").boundingBox();
  await page.mouse.click(
    rect.x + rect.width * 0.35,
    rect.y + rect.height * 0.4,
  );
  await page.mouse.click(
    rect.x + rect.width * 0.7,
    rect.y + rect.height * 0.65,
  );
  await save(page);
  expect(
    await page.evaluate(() => window.designSaved.design.elements[0].kind),
  ).toBe("pipe");
  await page.getByLabel("Add model element").selectOption("rectangle");
  await page.mouse.click(
    rect.x + rect.width * 0.2,
    rect.y + rect.height * 0.25,
  );
  await page.mouse.click(
    rect.x + rect.width * 0.4,
    rect.y + rect.height * 0.45,
  );
  await page
    .getByRole("button", { name: "Extrude shape", exact: true })
    .click();
  await save(page);
  expect(
    await page.evaluate(() => window.designSaved.design.elements[1].kind),
  ).toBe("profile");
  // Drag a real transform handle inside a scissored viewport.
  const before = await page.evaluate(
    () => window.designSaved.design.elements[1].position[0],
  );
  await page.waitForTimeout(100);
  const handle = await page.evaluate(() => {
    const e = window.test.scene,
      controls = e.scene.children.find((o) => o.controls?.getHelper).controls,
      r = e.inputRect();
    for (let y = r.top + 40; y < r.bottom - 20; y += 4)
      for (let x = r.left + 20; x < r.right - 20; x += 4) {
        controls.pointerHover({
          x: ((x - r.left) / r.width) * 2 - 1,
          y: (-(y - r.top) / r.height) * 2 + 1,
        });
        if (controls.axis === "X") return { x, y };
      }
    return null;
  });
  expect(handle).not.toBeNull();
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x + 35, handle.y, { steps: 8 });
  await page.mouse.up();
  await save(page);
  expect(
    await page.evaluate(
      () => window.designSaved.design.elements[1].position[0],
    ),
  ).not.toBe(before);
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await page
    .getByRole("button", { name: "Undo model edit", exact: true })
    .click();
  await save(page);
  expect(
    await page.evaluate(() => window.designSaved.design.elements.length),
  ).toBe(2);
  await page
    .getByRole("button", { name: "Redo model edit", exact: true })
    .click();
  await save(page);
  expect(
    await page.evaluate(() => window.designSaved.design.elements.length),
  ).toBe(3);
  // Middle-button navigation cannot create a draft or move an element.
  await page.getByRole("button", { name: "Front view", exact: true }).click();
  await page.getByLabel("Add model element").selectOption("line");
  const front = await page.locator("[data-cad-view=front]").boundingBox(),
    position = await page.evaluate(() =>
      window.test.scene.camera.position.toArray(),
    );
  await page.mouse.move(front.x + 70, front.y + 70);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(front.x + 110, front.y + 70, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  const next = await page.evaluate(() =>
    window.test.scene.camera.position.toArray(),
  );
  expect(next[0]).not.toBe(position[0]);
  expect(next[2]).toBeCloseTo(position[2]);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.screenshot({ path: path.join(screenshots, "desktop.png") });
  await page.getByRole("button", { name: "file", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download CAD file", exact: true })
    .click();
  const file = await downloaded,
    contents = JSON.parse(fs.readFileSync(await file.path(), "utf8"));
  expect(contents.design.elements.length).toBe(3);
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  await page.getByRole("button", { name: "Models", exact: true }).click();
  await page
    .getByRole("button", { name: "New CAD design", exact: true })
    .click();
  await page
    .getByLabel("Design name", { exact: true })
    .fill("Pipe fabrication");
  await page
    .getByRole("button", { name: "Create design", exact: true })
    .click();
  await page.waitForFunction(
    () => window.test?.ready && window.test.elements.length === 0,
  );
  await expect(page.locator("[data-cad-view]:visible")).toHaveCount(4);
  await page.getByLabel("Add model element").selectOption("pump");
  await page.getByRole("button", { name: "At view", exact: true }).click();
  await save(page);
  expect(
    await page.evaluate(() => window.designSaved.design.elements[0].kind),
  ).toBe("pump");
  await page.close();
  const phone = await browser.newPage({
    viewport: { width: 393, height: 851 },
    isMobile: true,
    hasTouch: true,
  });
  phone.on("pageerror", (e) => errors.push(e.message));
  await open(phone);
  await expect(phone.locator("[data-cad-view]:visible")).toHaveCount(1);
  await phone.getByRole("button", { name: "Front view", exact: true }).tap();
  await phone.getByLabel("Add model element").selectOption("pipe");
  const pane = await phone.locator("[data-cad-view=front]").boundingBox();
  await phone.touchscreen.tap(
    pane.x + pane.width * 0.2,
    pane.y + pane.height * 0.4,
  );
  await phone.touchscreen.tap(
    pane.x + pane.width * 0.7,
    pane.y + pane.height * 0.4,
  );
  await save(phone);
  await phone
    .getByRole("button", { name: "Toggle CAD inspector", exact: true })
    .tap();
  await phone.getByLabel("Pipe diameter (m)", { exact: true }).fill(".15");
  await phone.getByLabel("Element name", { exact: true }).tap();
  await save(phone);
  expect(
    await phone.evaluate(() => window.designSaved.design.elements[0].diameter),
  ).toBe(0.15);
  await phone.getByRole("button", { name: "layers", exact: true }).tap();
  await phone.getByLabel("New layer name").fill("Mechanical");
  await phone.getByRole("button", { name: "Add", exact: true }).tap();
  await phone.getByRole("button", { name: "properties", exact: true }).tap();
  await phone.getByLabel("Element layer").selectOption("Mechanical");
  await save(phone);
  expect(
    await phone.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(393);
  const saveBox = await phone
    .getByRole("button", { name: "Save design", exact: true })
    .boundingBox();
  expect(saveBox.x + saveBox.width).toBeLessThanOrEqual(393);
  await phone.screenshot({ path: path.join(screenshots, "phone.png") });
  await phone.getByRole("button", { name: "Close editor", exact: true }).tap();
  await phone.getByRole("button", { name: "Edit model", exact: true }).tap();
  await expect(phone.getByLabel("Element name", { exact: true })).toHaveValue(
    "Pipe",
  );
  expect(errors).toEqual([]);
  console.log(
    "PASS: CAD desktop/mobile, all four views, drawing, extrusion, gizmos, pan, undo/redo, layers, file export, blank IFC creation and save/reopen.",
  );
} finally {
  await browser.close();
  server.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
