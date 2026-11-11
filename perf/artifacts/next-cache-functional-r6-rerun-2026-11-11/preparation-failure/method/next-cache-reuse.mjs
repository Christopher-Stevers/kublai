// Reuse only the two previously compiled synthetic R6 variants. NO BUILD.
// Run under sealed lab/database.sh; STOP/30min ends that owned database scope.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const sha = value => createHash("sha256").update(value).digest("hex");
const here = path.dirname(fileURLToPath(import.meta.url));
const previous = "/tmp/foremanhq-next-functional-prepared-PjWuxF";
const prior = JSON.parse(await fs.readFile(path.join(previous, "prepared.json"), "utf8"));
const source = prior.frozenR6;
const expected = "3d4e7376001274a418390701935b8f474d6973a6ae4f8976ede74fd62e7c1c0d";
assert.equal(prior.sourceFingerprint, expected);
const harness = await fs.realpath(process.env.PERF_HARNESS_DIR);
const { verifyFrozenHarness } = await import(pathToFileURL(path.join(harness, "perf/harness-fingerprint.mjs")).href);
const sealed = await verifyFrozenHarness(harness);
assert.equal(sealed.harnessFingerprint, "25dfa8bfb3977677cfdd0340d7de19cf68895cd80000e19d14e4867f36dd41c4");
const socket = process.env.PERF_LAB_SOCKET;
assert(/^\/tmp\/foremanhq-perf-pg\.[^/]+$/.test(socket ?? ""));
await fs.access(path.join(socket, ".s.PGSQL.55463"));
const db = new URL(process.env.PERF_LAB_DATABASE_URL);
assert.equal(db.pathname, "/foremanhq_perf_lab"); assert.equal(db.searchParams.get("host"), socket);
assert.equal(process.env.DATABASE_URL, db.href);
const { sourceEvidence } = await import(pathToFileURL(path.join(source, "scripts/release/source-fingerprint.mjs")).href);
const captured = JSON.parse(await fs.readFile(path.join(previous, "functional-attempt-1.json"), "utf8"));
const fixtureBytes = await fs.readFile(process.env.PERF_LAB_FIXTURES);
const fixture = JSON.parse(fixtureBytes);
assert.equal(fixture.provenance, "isolated-seeded-app"); assert.equal(fixture.productionDatabase, false);
const assets = await fs.realpath(process.env.PERF_LAB_ASSETS);
assert(assets.startsWith(socket + path.sep));
assert.deepEqual(await fs.readdir(assets), ["uploads"]);
const assetUploads = path.join(assets, "uploads");
const attempt = await fs.mkdtemp(path.join(os.tmpdir(), "foremanhq-next-functional-reused-"));
await fs.mkdir(path.join(attempt, "method"));
const ownHashes = {};
for (const name of ["next-cache-reuse.mjs", "next-cache-functional.mjs", "next-cache-functional-supervisor.mjs", "next-cache-functional.md"]) {
  const bytes = await fs.readFile(path.join(here, name)); ownHashes[name] = sha(bytes);
  await fs.writeFile(path.join(attempt, "method", name), bytes, { mode: 0o444 });
}
const focusedMethod = sha(JSON.stringify({ protocol: "next-cache-functional-v1", syntheticAuthentication: true,
  original: expected, reusedFixtureMethod: prior.focusedMethod, sealed: sealed.harnessFingerprint, ownHashes }));
const state = { ...prior, privateSocket: socket, variants: [], ownHashes, focusedMethod,
  reusedFixtureMethod: prior.focusedMethod, reusedCompiledBytes: true, status: "preparing-reuse",
  startedAt: new Date().toISOString() };
delete state.owningScopeEndedAt;
const save = () => fs.writeFile(path.join(attempt, "prepared.json"), JSON.stringify(state, null, 2) + "\n");
try {
  await save();
  for (const variant of prior.variants) {
    const root = await fs.realpath(variant.root);
    assert(root.startsWith("/tmp/foremanhq-speed-app-")); await fs.access(path.join(root, "PERF_LAB_ONLY"));
    const evidence = await sourceEvidence(source, root, prior.sourceBuild);
    assert.equal(evidence.sourceFingerprint, expected);
    assert.equal((await fs.readFile(path.join(root, ".next/BUILD_ID"), "utf8")).trim(), variant.build);
    const packaging = captured.packaging.find(item => item.build === variant.build);
    assert(packaging);
    for (const [url, digest] of Object.entries(packaging.emittedAssets)) {
      assert(url.startsWith("/_next/static/") && !url.includes(".."));
      assert.equal(sha(await fs.readFile(path.join(root, ".next/static", url.slice("/_next/static/".length)))), digest);
    }
    const uploads = path.join(root, "uploads");
    const stat = await fs.lstat(uploads).catch(() => null);
    assert(!stat?.isSymbolicLink());
    await fs.copyFile(process.env.PERF_LAB_FIXTURES, path.join(root, "perf/fixtures.json"));
    await fs.rm(uploads, { recursive: true, force: true });
    await fs.mkdir(uploads);
    execFileSync("rsync", ["-a", assetUploads + "/", uploads + "/"], { timeout: 30_000 });
    state.variants.push({ ...variant, pid: null, base: null, fixtureSha256: sha(fixtureBytes),
      verifiedCompiledAssetCount: Object.keys(packaging.emittedAssets).length, verification: evidence.sourceVerification });
    await save();
  }
  await fs.copyFile(path.join(previous, "launch-backend.py"), path.join(attempt, "launch-backend.py"));
  state.launcherSha256 = sha(await fs.readFile(path.join(attempt, "launch-backend.py")));
  state.status = "compiled-reused-source-verified"; state.preparedAt = new Date().toISOString(); await save();
  console.log(JSON.stringify({ status: state.status, attemptDirectory: attempt, variants: state.variants.map(({ label, root, build }) => ({ label, root, build })) }));
  await new Promise(resolve => {
    let done = false;
    const finish = () => { if (done) return; done = true; clearInterval(poll); clearTimeout(limit); resolve(); };
    const poll = setInterval(() => fs.access(path.join(attempt, "STOP")).then(finish, () => {}), 1000);
    const limit = setTimeout(finish, 30 * 60_000);
    process.once("SIGTERM", finish); process.once("SIGINT", finish);
  });
  state.owningScopeEndedAt = new Date().toISOString(); await save();
} catch (error) { state.status = "failed-reuse"; state.error = error.message; await save(); throw error; }
