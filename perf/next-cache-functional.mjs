// Supplemental actual-app functional protocol, separate from frozen timing.
// SOURCE PREPARATION ONLY: no build/browser execution has validated this driver.
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const sha = value => createHash("sha256").update(value).digest("hex");
if (process.env.NEXT_FUNCTIONAL_SUPERVISED !== "1") throw Error("Run through the owned functional supervisor");
const requiredSource = "c49e8cbad84665aadc57323448c013f7c2420fa9cdff3992835164913bb7f161";
const requiredFingerprint = "3d4e7376001274a418390701935b8f474d6973a6ae4f8976ede74fd62e7c1c0d";
const config = JSON.parse(await fs.readFile(process.env.NEXT_CACHE_FUNCTIONAL_INPUT, "utf8"));
if (config.protocol !== "next-cache-functional-v1" || config.productionDatabase !== false)
  throw Error("Explicit supplemental disposable protocol required");
const report = { protocol: config.protocol, status: "prepared", sourceBuild: requiredSource,
  sourceFingerprint: requiredFingerprint, comparableTimingEvidence: false, realClerkEvidence: false,
  startedAt: new Date().toISOString(), assertions: [], limitations: [
    "Synthetic Clerk identity; no real Clerk/auth latency evidence",
    "One isolated job/rooms route and one dialog draft, not every private route or pending-work signal",
    "No final performance/field/physical-phone/full regression evidence",
    "Static proxy serves the fixture-emitted bytes; production wrapper/Brotli already has separate HTTP evidence",
    "No worker-version change; waiting-worker activation and chunk-failure recovery remain separate",
  ] };
const variants = [], staticFiles = new Map();
const actualInputs = {};
const module = fileURLToPath(import.meta.url);
actualInputs.driver = sha(await fs.readFile(module));
actualInputs.supervisor = sha(await fs.readFile(path.join(path.dirname(module), "next-cache-functional-supervisor.mjs")));
actualInputs.configuration = sha(await fs.readFile(process.env.NEXT_CACHE_FUNCTIONAL_INPUT));
const readJson = async file => JSON.parse(await fs.readFile(file, "utf8"));
async function walk(directory, relative = "") {
  const out = [];
  for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw Error("Unexpected symlink in compiled static assets");
    if (entry.isDirectory()) out.push(...await walk(directory, name));
    else if (entry.isFile() && /\.(?:js|css)$/.test(name)) out.push(name);
  }
  return out.sort();
}
async function validateVariant(input) {
  const root = await fs.realpath(input.root);
  if (!root.startsWith("/tmp/foremanhq-speed-app-")) throw Error("Only generated isolated source roots");
  await fs.access(path.join(root, "PERF_LAB_ONLY"));
  const evidence = await readJson(path.join(root, "source-evidence.json"));
  assert.equal(evidence.sourceBuild, requiredSource);
  assert.equal(evidence.sourceFingerprint, requiredFingerprint);
  const env = Object.fromEntries((await fs.readFile(`/proc/${input.pid}/environ`, "utf8")).split("\0").filter(Boolean).map(item => {
    const at = item.indexOf("="); return [item.slice(0, at), item.slice(at + 1)];
  }));
  assert.equal(await fs.realpath(`/proc/${input.pid}/cwd`), root);
  assert.equal(env.FOREMANHQ_BACKGROUND_MODE, "separate");
  assert.equal(env.BIM_WORKER_DISABLED, "1");
  assert.equal(env.PERF_LAB_SOCKET, config.privateSocket);
  const database = new URL(env.PERF_LAB_DATABASE_URL);
  assert.equal(database.pathname, "/foremanhq_perf_lab");
  assert.equal(database.searchParams.get("host"), config.privateSocket);
  assert.equal(env.DATABASE_URL, env.PERF_LAB_DATABASE_URL);
  if (!/^\/tmp\/foremanhq-perf-pg\.[^/]+$/.test(config.privateSocket)) throw Error("Private DB socket required");
  await fs.access(path.join(config.privateSocket, ".s.PGSQL.55463"));
  const base = new URL(input.base);
  if (base.hostname !== "127.0.0.1" || base.protocol !== "http:" || base.pathname !== "/") throw Error("Owned loopback origin required");
  const dist = await fs.realpath(path.join(root, input.dist));
  if (!dist.startsWith(root + path.sep)) throw Error("Build must remain inside marked fixture");
  const build = (await fs.readFile(path.join(dist, "BUILD_ID"), "utf8")).trim();
  if (!/^[a-f0-9]{64}$/.test(build)) throw Error("Actual fixture BUILD_ID must be valid hex");
  assert.equal(env.NEXT_PUBLIC_BUILD_ID, build);
  assert.equal(env.RELEASE_BUILD_ID, build);
  const attestation = await fetch(new URL("/api/perf-lab", base), { signal: AbortSignal.timeout(5000) }).then(r => r.json());
  assert.equal(attestation.productionDatabase, false);
  assert.equal(attestation.provenance, "isolated-seeded-app");
  const binding = await fetch(new URL("/api/device-cache-binding", base), { signal: AbortSignal.timeout(5000) }).then(r => r.json());
  assert.equal(binding.build, build);
  assert.equal(typeof binding.account, "string");
  const assets = [];
  for (const name of await walk(path.join(dist, "static"))) {
    const url = "/_next/static/" + name.split(path.sep).join("/");
    const bytes = await fs.readFile(path.join(dist, "static", name));
    const digest = sha(bytes);
    if (staticFiles.has(url)) assert.equal(staticFiles.get(url).digest, digest, "Retained fixture asset collision");
    staticFiles.set(url, { bytes, digest }); assets.push(url);
  }
  // Exact per-fixture map, never the canonical production chunk map.
  const manifest = { build, changedAssets: assets };
  const packaging = { build, assetCount: assets.length, manifestSha256: sha(JSON.stringify(manifest)),
    emittedAssets: Object.fromEntries(assets.map(url => [url, staticFiles.get(url).digest])) };
  return { ...input, root, dist, base, build, binding, manifest, packaging };
}
let browser, context, proxy, active = 0, offline = false;
const observations = { originRsc: 0, manifests: 0, staticFetches: 0, documents: 0, observationErrors: 0, nonprefetchRsc: [] };
const record = name => report.assertions.push({ name, passed: true });
try {
  assert.equal(config.variants.length, 2);
  for (const input of config.variants) variants.push(await validateVariant(input));
  assert.notEqual(variants[0].build, variants[1].build);
  assert.equal(variants[0].binding.account, variants[1].binding.account);
  const fixture = await readJson(path.join(variants[0].root, "perf/fixtures.json"));
  if (!/^[0-9a-f-]{36}$/.test(fixture.jobId)) throw Error("Synthetic fixture job required");
  const source = await fs.realpath(config.frozenR6);
  const helperPath = path.join(source, "scripts/release/source-fingerprint.mjs");
  const { sourceEvidence, LAB_TRANSFORM_PATHS } = await import(pathToFileURL(helperPath).href);
  actualInputs.sourceHelper = sha(await fs.readFile(helperPath));
  report.sourceVerification = [];
  for (const variant of variants) {
    const verified = await sourceEvidence(source, variant.root, requiredSource);
    assert.equal(verified.sourceFingerprint, requiredFingerprint);
    const transforms = {};
    for (const name of [...LAB_TRANSFORM_PATHS, "src/app/api/perf-lab/route.ts", "perf/auth/clerk-server.mjs", "perf/auth/clerk-client.jsx"])
      transforms[name] = sha(await fs.readFile(path.join(variant.root, name)));
    report.sourceVerification.push({ build: variant.build, verification: verified.sourceVerification, transforms });
  }
  const worker = await fs.readFile(path.join(source, "public/sw.js"));
  actualInputs.worker = sha(worker);
  const parityPaths = ["src/components/jobs/DrawingAccountProvider.tsx", "src/components/offline/ServiceWorkerRegistration.tsx",
    "src/app/jobs/[jobId]/page.tsx", "src/app/jobs/[jobId]/rooms/page.tsx", "src/components/jobs/JobWorkspaceOptions.tsx",
    "src/components/jobs/JobEditDialog.tsx", "src/lib/release-update.ts", "src/lib/release-safety.ts"];
  for (const name of parityPaths) {
    const canonical = sha(await fs.readFile(path.join(source, name)));
    for (const variant of variants) assert.equal(sha(await fs.readFile(path.join(variant.root, name))), canonical, `Production module changed: ${name}`);
    actualInputs[name] = canonical;
  }
  const beforeLog = await fs.readFile(path.join(config.privateSocket, "server.log"), "utf8");
  if (/\b(?:ERROR|FATAL|PANIC):/.test(beforeLog)) throw Error("Private DB already has errors");
  proxy = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, "http://localhost").pathname;
      if (req.headers.rsc === "1") observations.originRsc++;
      if (req.headers["sec-fetch-dest"] === "document") observations.documents++;
      const send = (type, bytes) => { res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(bytes); };
      if (pathname === "/sw.js") return send("application/javascript", worker);
      if (pathname === "/foremanhq-release-assets.json") { observations.manifests++; return send("application/json", JSON.stringify(variants[active].manifest)); }
      const asset = staticFiles.get(pathname);
      if (asset) { observations.staticFetches++; return send(pathname.endsWith(".css") ? "text/css" : "application/javascript", asset.bytes); }
      const target = new URL(req.url, variants[active].base);
      const forwarded = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host, "x-forwarded-proto": "http" } }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      forwarded.setTimeout(10_000, () => forwarded.destroy(Error("Fixture upstream timeout")));
      forwarded.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.pipe(forwarded);
    } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${proxy.address().port}`;
  const require = createRequire(path.join(source, "package.json"));
  const { chromium } = require("@playwright/test");
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", headless: true });
  context = await browser.newContext();
  const startPath = `/jobs/${fixture.jobId}`, destination = startPath + "/rooms";
  const open = async () => {
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    await page.goto(origin + startPath, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator('[data-job-card="rooms"]').waitFor();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller && window.__foremenhqReleaseRecoveryReady === true);
    return page;
  };
  const observe = page => page.on("response", async response => {
    try {
      const request = response.request(), headers = await request.allHeaders();
      if (headers.rsc === "1" && headers["next-router-prefetch"] !== "1") observations.nonprefetchRsc.push({
        pathname: new URL(response.url()).pathname, fromWorker: response.fromServiceWorker(), status: response.status(),
        treeSha256: sha(headers["next-router-state-tree"] ?? ""), nextUrlSha256: sha(headers["next-url"] ?? "") });
    } catch { observations.observationErrors++; }
  });
  const first = await open(); observe(first);
  const rscStart = observations.nonprefetchRsc.length;
  const naturalRsc = page => page.waitForResponse(async response => {
    const headers = await response.request().allHeaders();
    return new URL(response.url()).pathname === destination && headers.rsc === "1" && headers["next-router-prefetch"] !== "1";
  }, { timeout: 15_000 });
  const settle = promise => promise.then(response => ({ response }), error => ({ error: error.message }));
  const firstResponse = settle(naturalRsc(first));
  await first.locator('[data-job-card="rooms"]').click();
  const firstOutcome = await firstResponse;
  assert(!firstOutcome.error, firstOutcome.error);
  assert.equal(firstOutcome.response.status(), 200);
  await first.waitForURL(origin + destination);
  await first.waitForFunction(() => !document.querySelector('[data-route-loading]'));
  // A route changing via history or client state without an RSC response fails.
  await first.getByText(/^No rooms yet\./).first().waitFor();
  assert(observations.nonprefetchRsc.slice(rscStart).some(item => item.pathname === destination && item.status === 200), "No natural nonprefetch Next RSC response");
  record("real job route card produces a nonprefetch Next RSC response");
  await first.close();
  const second = await open(); observe(second);
  // A new tab has a fresh in-memory Next router cache. Do not clear/populate SW
  // caches, forge headers or evaluate router.push from test-only application code.
  const beforeOffline = observations.originRsc, offlineStart = observations.nonprefetchRsc.length;
  await context.setOffline(true); offline = true;
  const offlineResponse = settle(naturalRsc(second));
  await second.locator('[data-job-card="rooms"]').click();
  const offlineOutcome = await offlineResponse;
  assert(!offlineOutcome.error, offlineOutcome.error);
  const replay = offlineOutcome.response;
  assert.equal(replay.status(), 200); assert.equal(replay.fromServiceWorker(), true);
  await second.waitForURL(origin + destination);
  await second.getByText(/^No rooms yet\./).first().waitFor();
  assert(observations.nonprefetchRsc.slice(offlineStart).some(item => item.pathname === destination && item.fromWorker && item.status === 200), "No actual offline worker RSC hit");
  assert.equal(observations.originRsc, beforeOffline, "Offline visit reached origin");
  record("fresh-tab real Next navigation replays visited Flight through actual worker offline");
  await context.setOffline(false); offline = false;
  await second.close();
  const update = await open();
  // CDP offline→online may leave Network Quality Estimator values transient.
  // Observe at most five seconds, preserving every poll; never override it.
  const linkObservations = await update.evaluate(async () => {
    const observations = [], start = Date.now();
    do {
      const c = navigator.connection;
      const value = { elapsedMs: Date.now() - start, online: navigator.onLine, connectionPresent: !!c,
        effectiveType: c?.effectiveType ?? null, downlink: c?.downlink ?? null, saveData: c?.saveData ?? null };
      const criteria = { online: value.online, connection: !!c, noSaveData: !!c && !c.saveData,
        effective4g: c?.effectiveType === "4g", sufficientDownlink: !!c && (c.downlink === undefined || c.downlink >= 1.5) };
      observations.push({ ...value, criteria, permitted: Object.values(criteria).every(Boolean) });
      if (observations.at(-1).permitted || Date.now() - start >= 5000) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(250, 5000 - (Date.now() - start))));
    } while (true);
    return observations;
  });
  report.linkObservations = linkObservations;
  report.linkObservationProtocol = "natural-capability-polls-max-five-seconds-v1";
  const link = linkObservations.at(-1);
  report.link = link;
  assert(link.permitted, "Good-link update branch unavailable; no simulated pass");
  await update.getByRole("button", { name: "Edit job", exact: true }).click();
  const dialog = update.getByRole("dialog");
  await dialog.getByLabel("Job Name", { exact: false }).fill("Unsaved functional fixture draft");
  const beforeDocuments = observations.documents;
  const beforeManifests = observations.manifests;
  active = 1;
  // Visibility/focus is a normal coordinator trigger; no warm/activate/reload
  // messages or direct reload calls are injected by this protocol.
  await update.bringToFront();
  await update.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await update.waitForFunction(async assets => (await Promise.all(assets.map(url => caches.match(url)))).every(Boolean), variants[1].manifest.changedAssets, { timeout: 70_000 });
  assert(observations.manifests > beforeManifests, "Coordinator did not request the B manifest");
  await new Promise(resolve => setTimeout(resolve, 6500));
  assert.equal(observations.documents, beforeDocuments);
  assert.equal(await dialog.getByLabel("Job Name", { exact: false }).inputValue(), "Unsaved functional fixture draft");
  record("actual coordinator warms B while a real unsaved job dialog prevents reload");
  const navigation = settle(update.waitForEvent("domcontentloaded", { timeout: 20_000 }));
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const navigationOutcome = await navigation;
  assert(!navigationOutcome.error, navigationOutcome.error);
  assert.equal(new URL(update.url()).pathname, startPath);
  await update.locator('[data-job-card="rooms"]').waitFor();
  await new Promise(resolve => setTimeout(resolve, 6500));
  assert.equal(observations.documents, beforeDocuments + 1);
  record("normal draft cancellation reschedules exactly one quiet reload without another interaction");
  for (const url of variants[1].manifest.changedAssets) {
    const bytes = await update.evaluate(async url => { const r = await caches.match(url); return r ? Array.from(new Uint8Array(await r.arrayBuffer())) : null; }, url);
    assert.equal(sha(Uint8Array.from(bytes ?? [])), staticFiles.get(url).digest);
  }
  record("warmed fixture assets match the B compiled bytes");
  const afterLog = await fs.readFile(path.join(config.privateSocket, "server.log"), "utf8");
  assert(!/\b(?:ERROR|FATAL|PANIC):/.test(afterLog));
  report.databaseHealth = { errors: 0, beforeSha256: sha(beforeLog), afterSha256: sha(afterLog) };
  for (const input of config.variants) {
    await validateVariant(input);
    const verified = await sourceEvidence(source, input.root, requiredSource);
    assert.equal(verified.sourceFingerprint, requiredFingerprint);
  }
  report.status = "passed-supplemental-functional-smoke";
  assert.equal(observations.observationErrors, 0, "Incomplete browser response observation");
  report.browser = browser.version();
} catch (error) {
  report.status = "failed"; report.error = error.message; report.errorStack = error.stack; process.exitCode = 1;
} finally {
  if (offline) await context?.setOffline(false).catch(() => {});
  await context?.close(); await browser?.close();
  proxy?.closeAllConnections();
  if (proxy) await new Promise(resolve => proxy.close(resolve));
  report.finishedAt = new Date().toISOString(); report.observations = observations;
  report.inputs = actualInputs; report.packaging = variants.map(item => item.packaging);
  console.log(JSON.stringify(report, null, 2));
}
