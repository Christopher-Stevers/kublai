// Supplemental real-Chromium contract smoke; never a performance/gate report.
// Prepared during a timing quiet window: not yet executed or validated.
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

// The outer supervisor owns the attempt directory and a new process group.
// Its hard deadline does not depend on Playwright/server promises settling.
// Preserve stdout/stderr/report on every attempt; remove only disposable runtime.
if (!process.argv.includes("--owned-contract-worker")) {
  const attempt = await fs.mkdtemp(path.join(os.tmpdir(), "foremanhq-private-contract-attempt-"));
  const runtime = path.join(attempt, "runtime");
  await fs.mkdir(runtime);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--owned-contract-worker"], {
    detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PRIVATE_CONTRACT_RUNTIME: runtime },
  });
  const stdout = [], stderr = [];
  child.stdout.on("data", bytes => stdout.push(bytes));
  child.stderr.on("data", bytes => stderr.push(bytes));
  let timedOut = false, interrupted = false;
  const signalGroup = signal => {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  const interrupt = () => { interrupted = true; signalGroup("SIGKILL"); };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const deadline = setTimeout(() => { timedOut = true; signalGroup("SIGKILL"); }, 180_000);
  let code = 1, signal = null, spawnError = null;
  try {
    ({ code, signal } = await new Promise(resolve => {
      child.once("error", error => { spawnError = error.message; resolve({ code: 1, signal: null }); });
      child.once("close", (code, signal) => resolve({ code, signal }));
    }));
  } finally {
    clearTimeout(deadline);
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    signalGroup("SIGKILL");
    await fs.writeFile(path.join(attempt, "stdout.json"), Buffer.concat(stdout));
    await fs.writeFile(path.join(attempt, "stderr.log"), Buffer.concat(stderr));
    await fs.rm(runtime, { recursive: true, force: true });
  }
  let report;
  try { report = JSON.parse(Buffer.concat(stdout).toString()); }
  catch { report = { protocol: "private-cache-contract-v1", status: "failed", error: "Worker did not produce a complete report" }; }
  if (timedOut || interrupted || spawnError) report.status = "failed";
  report.supervisor = { timedOut, interrupted, exitCode: code, signal, spawnError, attemptDirectory: attempt, runtimeRemoved: true };
  await fs.writeFile(path.join(attempt, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  process.exit(code === 0 && !timedOut && !interrupted && !spawnError ? 0 : 1);
}
if (!process.env.PRIVATE_CONTRACT_RUNTIME?.startsWith(path.join(os.tmpdir(), "foremanhq-private-contract-attempt-")))
  throw Error("Contract worker must be launched by its owning supervisor");

const here = path.dirname(fileURLToPath(import.meta.url));
const expectedBuild = "c49e8cbad84665aadc57323448c013f7c2420fa9cdff3992835164913bb7f161";
const expectedFingerprint = "3d4e7376001274a418390701935b8f474d6973a6ae4f8976ede74fd62e7c1c0d";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const source = await fs.realpath(process.env.CONTRACT_R6_SOURCE ?? "/home/tim/.openclaw/workspace/releases/speed-phase1-reviewed-r6-20261111");
const metadata = JSON.parse(await fs.readFile(path.join(source, ".next-web/release-assets.json"), "utf8"));
if (metadata.build !== expectedBuild && metadata.sourceHash !== expectedBuild) throw Error("Expected frozen R6 build");
if (metadata.sourceFingerprint !== expectedFingerprint) throw Error("Expected frozen R6 source fingerprint");
const require = createRequire(path.join(source, "package.json"));
const esbuild = require("esbuild");
const { build } = esbuild;
const { chromium } = require("@playwright/test");
const root = await fs.realpath(process.env.PRIVATE_CONTRACT_RUNTIME);
const assertions = [];
const inputs = new Map();
const emitted = new Map();
const fixtureIds = [sha("foremanhq-private-contract-v1:A"), sha("foremanhq-private-contract-v1:B")];
const worker = await fs.readFile(path.join(source, "public/sw.js"));
inputs.set("public/sw.js", sha(worker));
let browser, context, server;
let active = 0, privateStatus = 200, malformed = false, failAsset = false;
let held = null, releaseHeld = null;
const deadline = setTimeout(() => {
  report.status = "timed-out";
  process.exitCode = 1;
  releaseHeld?.();
  void browser?.close();
  server?.closeAllConnections();
  server?.close();
  esbuild.stop();
}, 180_000);
const counts = { bindings: 0, privateReads: 0, assets: 0, manifests: 0 };
const report = { protocol: "private-cache-contract-v1", comparableTimingEvidence: false,
  productionAuthEvidence: false, actualNextFlightEvidence: false,
  sourceBuild: expectedBuild, sourceFingerprint: expectedFingerprint,
  assertions, unproved: ["actual Next router/Flight compatibility", "real authentication", "performance/full release gates",
    "automatic quiet reload and chunk-failure recovery (registration coordinator not included)"] };
const ok = name => assertions.push({ name, passed: true });
try {
  const fingerprintHelper = path.join(source, "scripts/release/source-fingerprint.mjs");
  inputs.set("scripts/release/source-fingerprint.mjs", sha(await fs.readFile(fingerprintHelper)));
  const { fingerprintSource } = await import(pathToFileURL(fingerprintHelper).href);
  const verified = await fingerprintSource(source);
  assert.equal(verified.sourceFingerprint, expectedFingerprint, "Frozen R6 public inputs changed");
  report.sourceVerifiedBefore = true;
  // Pin every loaded frozen-source module; fail rather than silently importing
  // current workspace production code. Only PDF/text rendering is substituted.
  for (const [index, id] of fixtureIds.entries()) {
    const outdir = path.join(root, String(index));
    await fs.mkdir(outdir);
    const result = await build({ entryPoints: [path.join(here, "private-cache-contract-entry.tsx")],
      bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic",
      absWorkingDir: source, nodePaths: [path.join(source, "node_modules")],
      define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_BUILD_ID": JSON.stringify(id) },
      plugins: [{ name: "frozen-r6-only", setup(builder) {
        builder.onResolve({ filter: /^(?:react|react-dom\/client|react\/jsx-runtime|@tanstack\/react-query)$/ }, args => ({ path: require.resolve(args.path) }));
        builder.onResolve({ filter: /^~\// }, args => {
          if (/\/(?:pdf-client|drawing-text)$/.test(args.path)) return { path: args.path.endsWith("drawing-text") ? "text-cleanup" : "pdf-cleanup", namespace: "cleanup" };
          const base = path.join(source, "src", args.path.slice(2));
          const resolved = [base, base + ".ts", base + ".tsx", base + ".js", path.join(base, "index.ts")].find(existsSync);
          if (!resolved) throw Error(`Unresolved frozen import: ${args.path}`);
          return { path: resolved };
        });
        builder.onResolve({ filter: /(?:^|\/)pdf-client$|(?:^|\/)drawing-text$/ }, args => ({ path: args.path.endsWith("drawing-text") ? "text-cleanup" : "pdf-cleanup", namespace: "cleanup" }));
        builder.onLoad({ filter: /.*/, namespace: "cleanup" }, args => ({ contents: args.path === "text-cleanup"
          ? "export function clearDrawingTextIndexes(){}"
          : "export function clearPdfDocuments(){};export function sourcePdfPage(){throw Error('PDF rendering excluded from contract')}" }));
        builder.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async args => {
          if (!args.path.startsWith(source + path.sep) || args.path.includes(`${path.sep}node_modules${path.sep}`)) return;
          const bytes = await fs.readFile(args.path);
          const name = path.relative(source, args.path);
          const digest = sha(bytes);
          if (inputs.has(name) && inputs.get(name) !== digest) throw Error("Frozen input changed between fixture builds");
          inputs.set(name, digest);
          return { contents: bytes.toString(), loader: args.path.endsWith(".tsx") ? "tsx" : args.path.endsWith(".ts") ? "ts" : "js" };
        });
      } }], metafile: true });
    const bytes = result.outputFiles[0].contents;
    const url = `/_next/static/contract-${sha(bytes)}.js`;
    emitted.set(url, { bytes, contentType: "application/javascript" });
    await fs.writeFile(path.join(outdir, "metafile.json"), JSON.stringify(result.metafile));
    await fs.writeFile(path.join(outdir, "manifest.json"), JSON.stringify({ build: id, changedAssets: [url] }));
    report[`variant${index}`] = { build: id, asset: url, sha256: sha(bytes) };
  }
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const cookie = /(?:^|; )contract-user=([AB])(?:;|$)/.exec(req.headers.cookie ?? "")?.[1];
      const send = (status, type, body) => { res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(body); };
      if (url.pathname === "/fixture/session" && req.method === "POST") {
        const user = url.searchParams.get("user");
        res.setHeader("Set-Cookie", `contract-user=${["A", "B"].includes(user) ? user : ""}; Path=/; HttpOnly; SameSite=Strict`);
        return send(200, "application/json", "{}");
      }
      if (url.pathname === "/api/device-cache-binding") {
        counts.bindings++;
        return send(cookie ? 200 : 401, "application/json", JSON.stringify({ account: cookie ? `fixture-org:${cookie}` : null, build: fixtureIds[active] }));
      }
      if (url.pathname === "/sw.js") return send(200, "application/javascript", worker);
      if (url.pathname === "/foremanhq-release-assets.json") {
        counts.manifests++;
        return send(200, "application/json", malformed ? JSON.stringify({ build: fixtureIds[active], changedAssets: ["https://example.invalid/private.js"] })
          : await fs.readFile(path.join(root, String(active), "manifest.json")));
      }
      if (emitted.has(url.pathname)) {
        counts.assets++;
        const asset = emitted.get(url.pathname);
        return send(failAsset ? 503 : 200, asset.contentType, failAsset ? "unavailable" : asset.bytes);
      }
      if (req.headers.rsc === "1" || url.searchParams.has("_rsc")) {
        counts.privateReads++;
        const body = JSON.stringify({ synthetic: true, account: cookie ?? "none", tree: req.headers["next-router-state-tree"] });
        const status = cookie ? privateStatus : 401;
        if (held) { const notify = held; held = null; notify(); await new Promise(resolve => { releaseHeld = resolve; }); }
        return send(status, "text/x-component", body);
      }
      if (url.pathname === "/offline.html") return send(200, "text/html", "<h1>Reconnect</h1>");
      if (["/", "/jobs"].includes(url.pathname)) {
        if (!cookie) res.setHeader("Set-Cookie", "contract-user=A; Path=/; HttpOnly; SameSite=Strict");
        return send(200, "text/html", `<!doctype html><div id="root"></div><script>window.__contractUser=${JSON.stringify(cookie ?? "A")}</script><script type="module" src="${report[`variant${active}`].asset}"></script>`);
      }
      return send(404, "text/plain", "not found");
    } catch { res.writeHead(500); res.end("fixture failure"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", headless: true });
  context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  const call = (method, ...args) => page.evaluate(({ method, args }) => window.contract[method](...args), { method, args });
  const cacheKeys = () => page.evaluate(async () => (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(r => r.url)))).flat());
  const waitKey = account => page.waitForFunction(async account => {
    const keys = (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(r => r.url)))).flat();
    return keys.some(value => new URL(value).searchParams.get("__device_account")?.startsWith(account));
  }, account);
  await page.goto(origin);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller && !!window.contract);
  await page.locator("#bound").filter({ hasText: "fixture-org:A" }).waitFor();
  // A successful cached response is the binding acknowledgement; observing an
  // API request alone would race its validation/message completion.
  await page.waitForFunction(async () => { await window.contract.flight(); return (await Promise.all((await caches.keys()).map(async n => (await (await caches.open(n)).keys()).map(r => r.url)))).flat().some(u => new URL(u).searchParams.get("__device_account")?.startsWith("fixture-org:A:build:")); });
  ok("actual provider and server-checked worker binding");
  assert((await cacheKeys()).some(u => new URL(u).searchParams.get("__device_account") === `fixture-org:A:build:${fixtureIds[0]}`));
  ok("private cache scope includes the compiled valid-hex fixture build");
  privateStatus = 503;
  assert.equal(JSON.parse((await call("flight")).text).account, "A");
  assert.equal((await call("flight", "other-tree")).status, 503);
  ok("visited synthetic Flight replay is tree scoped");
  privateStatus = 200;
  await call("flight", "prefetch-only", true);
  privateStatus = 503;
  assert.equal((await call("flight", "prefetch-only")).status, 503);
  ok("prefetch does not qualify as visited");
  privateStatus = 200;
  await call("login", "B");
  await page.locator("#bound").filter({ hasText: "fixture-org:B" }).waitFor();
  await page.waitForFunction(async () => { await window.contract.flight(); return (await Promise.all((await caches.keys()).map(async n => (await (await caches.open(n)).keys()).map(r => r.url)))).flat().some(u => new URL(u).searchParams.get("__device_account")?.startsWith("fixture-org:B:build:")); });
  assert(!(await cacheKeys()).some(u => new URL(u).searchParams.get("__device_account")?.startsWith("fixture-org:A:")));
  ok("account transition purges old private scope");
  // Hold an uncached A response, replace the validated binding with B, then
  // release A. The old response may reach its initiating fetch but must never
  // become a persistent replay under either account after the transition.
  await call("login", "A");
  await page.locator("#bound").filter({ hasText: "fixture-org:A" }).waitFor();
  await page.waitForFunction(async () => { await window.contract.flight(); return (await Promise.all((await caches.keys()).map(async n => (await (await caches.open(n)).keys()).map(r => r.url)))).flat().some(u => new URL(u).searchParams.get("__device_account")?.startsWith("fixture-org:A:build:")); });
  const arrived = new Promise(resolve => { held = resolve; });
  const oldRead = call("flight", "late-A-tree");
  await arrived;
  await call("login", "B");
  await page.locator("#bound").filter({ hasText: "fixture-org:B" }).waitFor();
  await page.waitForFunction(async () => { await window.contract.flight(); return (await Promise.all((await caches.keys()).map(async n => (await (await caches.open(n)).keys()).map(r => r.url)))).flat().some(u => new URL(u).searchParams.get("__device_account")?.startsWith("fixture-org:B:build:")); });
  releaseHeld(); releaseHeld = null;
  await oldRead;
  assert(!(await cacheKeys()).some(u => new URL(u).searchParams.get("__device_tree") === "late-A-tree"));
  ok("late in-flight old-account response cannot repopulate cache");
  await page.waitForFunction(async () => { await window.contract.flight(); return (await Promise.all((await caches.keys()).map(async n => (await (await caches.open(n)).keys()).map(r => r.url)))).flat().some(u => new URL(u).searchParams.get("__device_account")?.startsWith("fixture-org:B:build:")); });
  const secondTab = await context.newPage();
  await secondTab.goto(origin);
  await secondTab.waitForFunction(() => !!navigator.serviceWorker.controller && !!window.contract);
  await secondTab.locator("#bound").filter({ hasText: "fixture-org:B" }).waitFor();
  await secondTab.waitForFunction(async () => { await window.contract.flight("second-tab-tree"); return (await Promise.all((await caches.keys()).map(async n => (await (await caches.open(n)).keys()).map(r => r.url)))).flat().some(u => new URL(u).searchParams.get("__device_tree") === "second-tab-tree"); });
  privateStatus = 403;
  await call("flight", "denial-new-tree");
  await page.getByRole("alert").waitFor();
  await secondTab.getByRole("alert").waitFor();
  assert(!(await cacheKeys()).some(u => new URL(u).searchParams.get("__device_account")?.startsWith("fixture-org:B:")));
  ok("terminal denial locks provider and purges current account scope");
  ok("authoritative denial also locks another bound tab");
  await secondTab.close();
  privateStatus = 200;
  await call("login", "A");
  await page.locator("#bound").filter({ hasText: "fixture-org:A" }).waitFor();
  await call("logout");
  await page.locator("#bound").filter({ hasText: "signed-out" }).waitFor();
  assert.equal((await call("flight")).status, 401);
  ok("logout cannot replay a saved private response");
  active = 1;
  failAsset = true;
  assert.equal((await call("warm", fixtureIds[1])).ready, false);
  ok("failed changed-asset fetch does not report update ready");
  failAsset = false;
  const result = await call("warm", fixtureIds[1]);
  assert.equal(result.ready, true);
  const cached = await page.evaluate(async url => { const r = await caches.match(url); return r ? Array.from(new Uint8Array(await r.arrayBuffer())) : null; }, report.variant1.asset);
  assert.equal(sha(Uint8Array.from(cached ?? [])), report.variant1.sha256);
  ok("worker warms actual emitted B bytes from B manifest");
  malformed = true;
  assert.equal((await call("warm", fixtureIds[1])).ready, false);
  ok("cross-origin malformed manifest rejected");
  malformed = false;
  report.unproved.push("cold private HTML auth (synthetic document endpoint)");
  report.status = "partial-contract-smoke";
  report.browser = browser.version();
} catch (error) {
  report.status = "failed";
  report.error = String(error?.message ?? error);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  releaseHeld?.();
  await context?.close();
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  const entry = await fs.readFile(path.join(here, "private-cache-contract-entry.tsx"));
  const driver = await fs.readFile(fileURLToPath(import.meta.url));
  report.provenance = { node: process.version, driverSha256: sha(driver), entrySha256: sha(entry),
    frozenInputs: Object.fromEntries([...inputs].sort(([a], [b]) => a.localeCompare(b))),
    substitutions: ["PDF/text rendering cleanup only", "synthetic HttpOnly loopback session and binding/read endpoints"],
    counts, fixtureBuilds: fixtureIds };
  report.provenance.toolchain = { esbuild: esbuild.version,
    playwright: require("@playwright/test/package.json").version,
    frozenLockSha256: sha(await fs.readFile(path.join(source, "pnpm-lock.yaml"))) };
  report.provenance.inputsUnchanged = (await Promise.all([...inputs].map(async ([name, digest]) =>
    sha(await fs.readFile(path.join(source, name))) === digest))).every(Boolean);
  if (!report.provenance.inputsUnchanged) { report.status = "failed"; process.exitCode = 1; }
  // Report remains on stdout, never mutates a capture or a frozen method file.
  console.log(JSON.stringify(report, null, 2));
  await fs.rm(root, { recursive: true, force: true });
}
