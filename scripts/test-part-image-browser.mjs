// Component-only verification. The metadata resource is deliberately replaced.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve("tsx"))("esbuild");
const temp = await fs.mkdtemp(
  path.join(os.tmpdir(), "foremanhq-part-image-browser-"),
);
const out = path.resolve(
  process.env.PART_IMAGE_REPORT ??
    "perf/artifacts/part-image-browser-2026-11-11.json",
);
const report = {
  nextImageBridge:
    "Actual next/dist/client/image-component.js named Image re-export; standalone esbuild CJS interop only",
  method: "part-image-component-browser-v1",
  resourceSeam:
    "scripts/fixtures/part-image/resource.js replaces ONLY ~/lib/part-image-layout-resource",
  limits: [
    "Component DOM/geometry/sticky fallback/cached fixture offline reuse only",
    "Not production chunk caching, photo fidelity or app latency",
  ],
  checks: [],
  externalRequests: [],
  cleanup: {},
};
let server, browser, context;
const watchdog = setTimeout(() => {
  report.watchdogExpired = true;
  void browser?.close();
  server?.closeAllConnections();
  server?.close();
}, 60_000);
try {
  report.sources = {};
  for (const file of [
    "src/components/catalogue/PartImage.tsx",
    "scripts/fixtures/part-image/app.jsx",
    "scripts/fixtures/part-image/resource.js",
    "scripts/fixtures/part-image/next-image.js",
  ])
    report.sources[file] = createHash("sha256")
      .update(await fs.readFile(file))
      .digest("hex");
  await esbuild.build({
    entryPoints: ["scripts/fixtures/part-image/app.jsx"],
    outfile: path.join(temp, "app.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    define: {
      "process.env": "{}",
      "process.env.NODE_ENV": '"production"',
      "process.env.__NEXT_IMAGE_OPTS": "undefined",
    },
    plugins: [
      {
        name: "metadata-seam",
        setup(build) {
          build.onResolve({ filter: /^next\/image$/ }, () => ({
            path: path.resolve("scripts/fixtures/part-image/next-image.js"),
          }));
          build.onResolve(
            { filter: /^~\/lib\/part-image-layout-resource$/ },
            () => ({
              path: path.resolve("scripts/fixtures/part-image/resource.js"),
            }),
          );
        },
      },
    ],
  });
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#fafafa"/><rect x="100" y="80" width="200" height="180" fill="#336699"/></svg>';
  server = http.createServer(async (req, res) => {
    const name = new URL(req.url, "http://localhost").pathname;
    if (name === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><html><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
      );
    } else if (name === "/app.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(await fs.readFile(path.join(temp, "app.js")));
    } else if (name === "/api/catalogue/images/synthetic.svg") {
      res.setHeader("Content-Type", "image/svg+xml");
      res.end(svg);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  report.origin = origin;
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
  });
  context = await browser.newContext({ viewport: { width: 900, height: 500 } });
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    report.externalRequests.push({ method: route.request().method() });
    return route.abort();
  });
  const page = await context.newPage();
  report.browserErrors = [];
  page.on("pageerror", (error) => report.browserErrors.push(String(error)));
  page.setDefaultTimeout(5000);
  await page.goto(origin);
  const fill = page.locator('[data-case="fill-0"] > svg'),
    fixed = page.locator('[data-case="fixed-0"] > svg');
  await expect(fill).toHaveAttribute("data-part-image-layout", "pending");
  await expect(fixed).toHaveAttribute("data-part-image-layout", "pending");
  const before = {
    fill: await fill.boundingBox(),
    fixed: await fixed.boundingBox(),
  };
  const layouts = {
    "/api/catalogue/images/synthetic.svg": {
      width: 600,
      height: 400,
      box: [30, 40, 500, 300],
      background: "#fafafa",
    },
  };
  await page.evaluate(
    (value) => window.metadataFixture.resolve(value),
    layouts,
  );
  await expect(fill).toHaveAttribute("data-part-image-layout", "audited");
  assert.deepEqual(await fill.boundingBox(), before.fill);
  assert.deepEqual(await fixed.boundingBox(), before.fixed);
  const inner = fill.locator("svg");
  for (const [name, value] of Object.entries({
    x: "8%",
    y: "8%",
    width: "84%",
    height: "84%",
    viewBox: "30 40 500 300",
    preserveAspectRatio: "xMidYMid meet",
  }))
    await expect(inner).toHaveAttribute(name, value);
  await expect(fill.locator("rect")).toHaveAttribute("fill", "#fafafa");
  await expect(fill.locator("image")).toHaveAttribute("width", "600");
  await expect(fill.locator("image")).toHaveAttribute("height", "400");
  report.checks.push({
    name: "pending-to-audited fixed/fill boxes and exact SVG geometry",
    pass: true,
    before,
    after: { fill: await fill.boundingBox(), fixed: await fixed.boundingBox() },
  });
  await page.evaluate(() => {
    window.metadataFixture.reset();
    window.renderFixture("failure");
  });
  await expect(fill).toHaveAttribute("data-part-image-layout", "pending");
  await page.evaluate(() => window.metadataFixture.reject());
  await expect(page.locator('[data-case="fill-0"] > img')).toHaveAttribute(
    "src",
    "/api/catalogue/images/synthetic.svg",
  );
  await page.evaluate((value) => {
    window.metadataFixture.resolve(value);
    window.renderFixture("failure", 2);
  }, layouts);
  await expect(page.locator('[data-case="fill-1"] > svg')).toHaveAttribute(
    "data-part-image-layout",
    "audited",
  );
  await expect(page.locator('[data-case="fill-0"] > img')).toHaveCount(1);
  report.checks.push({
    name: "failure uses actual Next/Image; later cached metadata does not recrop mounted fallback",
    pass: true,
  });
  const calls = await page.evaluate(() => window.metadataFixture.calls());
  await context.setOffline(true);
  await page.evaluate(() => window.renderFixture("offline"));
  await expect(fill).toHaveAttribute("data-part-image-layout", "audited");
  assert.equal(
    await page.evaluate(() => window.metadataFixture.calls()),
    calls,
  );
  report.checks.push({
    name: "same-page cached fixture metadata remount while offline without resource load",
    pass: true,
  });
  assert.equal(report.externalRequests.length, 0);
  assert.equal(report.watchdogExpired, undefined);
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.error = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  try {
    await browser?.close();
    report.cleanup.browserClosed = true;
  } catch (error) {
    report.cleanup.browserError = String(error);
    process.exitCode = 1;
  }
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    report.cleanup.serverClosed = true;
  }
  await fs.rm(temp, { recursive: true, force: true });
  report.cleanup.tempRemoved = true;
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
