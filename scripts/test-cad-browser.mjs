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
for (const name of ["solid", "cad-export", "cad-dxf"])
  await esbuild.build({
    entryPoints: [`src/lib/bim/${name}.worker.ts`],
    outfile: path.join(temp, `${name}.worker.js`),
    bundle: true,
    format: "iife",
    platform: "browser",
  });
const css = await postcss([tailwind()]).process(
  fs.readFileSync("src/styles/globals.css", "utf8"),
  { from: "src/styles/globals.css" },
);
const routes = {
  "/solid.worker.ts": path.join(temp, "solid.worker.js"),
  "/lib/bim/cad-export.worker.ts": path.join(temp, "cad-export.worker.js"),
  "/lib/bim/cad-dxf.worker.ts": path.join(temp, "cad-dxf.worker.js"),
  "/api/models/kernel/manifold-3.5.4.js": path.join(
    path.dirname(require.resolve("manifold-3d/manifold.js")),
    "manifold.js",
  ),
  "/api/models/wasm/manifold-3.5.4.wasm": path.join(
    path.dirname(require.resolve("manifold-3d/manifold.js")),
    "manifold.wasm",
  ),
  "/app.js": path.join(temp, "app.js"),
  "/lib/bim/ifc.worker.ts": path.join(temp, "worker.js"),
  "/api/models/wasm/web-ifc.wasm": path.join(
    path.dirname(require.resolve("web-ifc")),
    "web-ifc.wasm",
  ),
  "/api/models/files/10000000-0000-4000-8000-000000000001":
    "src/lib/bim/fixtures/construction.ifc",
};
// Optionally validate the actual Next/webpack worker output before deployment.
const productionBuild =
  process.env.CAD_BUILD_DIR && path.resolve(process.env.CAD_BUILD_DIR);
if (productionBuild) {
  const chunks = path.join(productionBuild, "static/chunks"),
    files = fs.readdirSync(chunks).filter((file) => file.endsWith(".js"));
  for (const [route, marker] of [
    ["/solid.worker.ts", "manifold-3.5.4.js"],
    ["/lib/bim/cad-export.worker.ts", "IFCTRIANGULATEDFACESET"],
    [
      "/lib/bim/cad-dxf.worker.ts",
      "The DXF contains an invalid circle radius.",
    ],
  ]) {
    const matches = files.filter((file) =>
      fs.readFileSync(path.join(chunks, file), "utf8").includes(marker),
    );
    if (matches.length !== 1)
      throw Error(
        `Expected one compiled worker for ${route}, found ${matches.length}`,
      );
    routes[route] = path.join(chunks, matches[0]);
  }
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost"),
    file =
      productionBuild && /^\/_next\/static\/[a-zA-Z0-9_./-]+$/.test(u.pathname)
        ? path.join(productionBuild, u.pathname.slice("/_next/".length))
        : routes[u.pathname];
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
  // Fresh workspace, actual solid worker, library and IFC export.
  const advanced = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  advanced.on("pageerror", (e) => errors.push(e.message));
  await open(advanced);
  for (const name of ["Body", "Cutter"]) {
    await advanced.getByLabel("Add model element").selectOption("box");
    await advanced
      .getByRole("button", { name: "At view", exact: true })
      .click();
    await advanced.getByLabel("Element name", { exact: true }).fill(name);
    if (name === "Cutter") {
      const input = advanced.getByLabel("Position (m) X", { exact: true });
      const before = Number(await input.inputValue());
      await input.fill(String(before + 0.5));
      await input.press("Enter");
    }
    await save(advanced);
  }
  await advanced.getByRole("button", { name: "objects", exact: true }).click();
  await advanced
    .getByRole("button", { name: "Select all", exact: true })
    .click();
  await advanced.getByRole("button", { name: "modify", exact: true }).click();
  await advanced.getByRole("button", { name: "Subtract", exact: true }).click();
  await expect(advanced.getByText(/Last solid:/)).toBeVisible({
    timeout: 30000,
  });
  await save(advanced);
  expect(
    await advanced.evaluate(() => window.designSaved.design.elements.length),
  ).toBe(1);
  expect(
    await advanced.evaluate(() => window.designSaved.design.elements[0].kind),
  ).toBe("solid");
  await advanced
    .getByRole("button", { name: "Undo model edit", exact: true })
    .click();
  await save(advanced);
  expect(
    await advanced.evaluate(() => window.designSaved.design.elements.length),
  ).toBe(2);
  await advanced
    .getByRole("button", { name: "Redo model edit", exact: true })
    .click();
  await save(advanced);
  await advanced.getByRole("button", { name: "library", exact: true }).click();
  await advanced
    .getByLabel("Component name", { exact: true })
    .fill("Valve block");
  await advanced
    .getByRole("button", { name: "Save selection as component", exact: true })
    .click();
  await advanced
    .getByRole("button", { name: "Insert Valve block", exact: true })
    .click();
  await save(advanced);
  expect(
    await advanced.evaluate(() => window.designSaved.design.components.length),
  ).toBe(1);
  expect(
    await advanced.evaluate(() => window.designSaved.design.elements.length),
  ).toBe(2);
  await advanced.getByRole("button", { name: "file", exact: true }).click();
  const ifcDownload = advanced.waitForEvent("download");
  await advanced
    .getByRole("button", { name: "Export entire edited model", exact: true })
    .click();
  const ifcFile = await ifcDownload;
  const ifcText = fs.readFileSync(await ifcFile.path(), "utf8");
  expect(ifcText).toContain("IFCTRIANGULATEDFACESET");
  fs.writeFileSync(path.join(screenshots, "edited-model.ifc"), ifcText);
  await advanced
    .getByRole("button", { name: "properties", exact: true })
    .click();
  await advanced.getByRole("button", { name: "Focus", exact: true }).click();
  await advanced.screenshot({ path: path.join(screenshots, "solids.png") });
  await advanced.close();
  // Associative dimension, draggable sketch vertices and a real DXF import worker.
  const precision = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  precision.on("pageerror", (e) => errors.push(e.message));
  await open(precision);
  await precision
    .getByRole("button", { name: "Front view", exact: true })
    .click();
  await precision.getByLabel("Add model element").selectOption("line");
  const drawing = await precision
    .locator("[data-cad-view=front]")
    .boundingBox();
  await precision.mouse.click(
    drawing.x + drawing.width * 0.25,
    drawing.y + drawing.height * 0.4,
  );
  await precision.mouse.click(
    drawing.x + drawing.width * 0.6,
    drawing.y + drawing.height * 0.4,
  );
  await precision
    .getByLabel("Element name", { exact: true })
    .fill("Reference edge");
  await save(precision);
  await precision.getByRole("button", { name: "Focus", exact: true }).click();
  await precision.waitForTimeout(150);
  const endpoints = await precision.evaluate(() => {
    const engine = window.test.scene,
      element = window.designSaved.design.elements[0],
      r = engine.inputRect();
    let object;
    engine.scene.traverse((o) => {
      if (o.userData.designId === element.id) object = o;
    });
    return element.points.map((point) => {
      const p = object
        .localToWorld(object.position.clone().set(...point))
        .project(engine.camera);
      return {
        x: r.left + ((p.x + 1) * r.width) / 2,
        y: r.top + ((1 - p.y) * r.height) / 2,
      };
    });
  });
  await precision.getByLabel("Add model element").selectOption("dimension");
  for (const p of endpoints) await precision.mouse.click(p.x, p.y);
  await save(precision);
  const dimensionBefore = await precision.evaluate(
    () => window.designSaved.design.elements[1],
  );
  expect(dimensionBefore.kind).toBe("dimension");
  expect(dimensionBefore.dimension.anchors.every(Boolean)).toBe(true);
  await precision.getByRole("button", { name: "objects", exact: true }).click();
  await precision.getByRole("button", { name: /^Reference edge/ }).click();
  await precision
    .getByRole("button", { name: "properties", exact: true })
    .click();
  await precision
    .getByLabel("Edit vertices on drawing", { exact: true })
    .check();
  await precision.waitForTimeout(100);
  const vertexHandle = await precision.evaluate(() => {
    const engine = window.test.scene,
      controls = engine.scene.children.find(
        (o) => o.controls?.getHelper,
      ).controls,
      r = engine.inputRect();
    for (let y = r.top + 30; y < r.bottom - 20; y += 4)
      for (let x = r.left + 15; x < r.right - 15; x += 4) {
        controls.pointerHover({
          x: ((x - r.left) / r.width) * 2 - 1,
          y: -((y - r.top) / r.height) * 2 + 1,
        });
        if (controls.axis === "X") return { x, y };
      }
    return null;
  });
  expect(vertexHandle).not.toBeNull();
  await precision.mouse.move(vertexHandle.x, vertexHandle.y);
  await precision.mouse.down();
  await precision.mouse.move(vertexHandle.x + 24, vertexHandle.y, { steps: 8 });
  await precision.mouse.up();
  await save(precision);
  const dimensionAfter = await precision.evaluate(
    () => window.designSaved.design.elements[1],
  );
  expect(dimensionAfter.points[0]).not.toEqual(dimensionBefore.points[0]);
  expect(dimensionAfter.dimension.anchors).toEqual(
    dimensionBefore.dimension.anchors,
  );
  await precision.screenshot({
    path: path.join(screenshots, "dimensions.png"),
  });
  await precision.getByRole("button", { name: "file", exact: true }).click();
  await precision
    .getByLabel("Import DXF", { exact: true })
    .setInputFiles("src/lib/bim/fixtures/cad-import.dxf");
  await expect(
    precision.getByRole("button", { name: "Add DXF to design", exact: true }),
  ).toBeVisible();
  await expect(precision.getByText(/source units: mm/)).toBeVisible();
  await precision
    .getByRole("button", { name: "Add DXF to design", exact: true })
    .click();
  await save(precision);
  expect(
    await precision.evaluate(() => window.designSaved.design.elements.length),
  ).toBe(7);
  await precision
    .getByRole("button", { name: "Undo model edit", exact: true })
    .click();
  await save(precision);
  expect(
    await precision.evaluate(() => window.designSaved.design.elements.length),
  ).toBe(2);
  await precision
    .getByRole("button", { name: "Redo model edit", exact: true })
    .click();
  await save(precision);
  await precision.getByRole("button", { name: "file", exact: true }).click();
  const dimensionsIfc = precision.waitForEvent("download");
  await precision
    .getByRole("button", { name: "Export design as IFC", exact: true })
    .click();
  fs.copyFileSync(
    await (await dimensionsIfc).path(),
    path.join(screenshots, "dimensions.ifc"),
  );
  const dimensionsDxf = precision.waitForEvent("download");
  await precision
    .getByRole("button", { name: "Export DXF linework", exact: true })
    .click();
  fs.copyFileSync(
    await (await dimensionsDxf).path(),
    path.join(screenshots, "dimensions.dxf"),
  );
  await precision.close();

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
  await phone.getByRole("button", { name: "modify", exact: true }).tap();
  await phone
    .getByRole("button", { name: "Make editable solid", exact: true })
    .tap();
  await expect(phone.getByText(/Last solid:/)).toBeVisible({ timeout: 30000 });
  await save(phone);
  expect(
    await phone.evaluate(() => window.designSaved.design.elements[0].kind),
  ).toBe("solid");
  await phone
    .getByRole("button", { name: "Undo model edit", exact: true })
    .tap();
  await save(phone);
  await phone.getByRole("button", { name: "objects", exact: true }).tap();
  await phone.getByRole("button", { name: /^Pipe Pipe/ }).tap();
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
    (productionBuild ? "Production workers: " : "") +
      "PASS: CAD desktop/mobile, all four views, drawing, extrusion, gizmos, pan, undo/redo, layers, file export, blank IFC creation, Manifold solid cuts, components, dimensions, vertex grips, DXF import and IFC/DXF export, and save/reopen.",
  );
} finally {
  await browser.close();
  server.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
