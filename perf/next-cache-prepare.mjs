// Run only under the sealed lab/database.sh. Copies/verifies source; NO BUILD.
// Holds the owning private-DB scope until STOP is written or its 45min limit.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
const sha = value => createHash("sha256").update(value).digest("hex");
const here = path.dirname(fileURLToPath(import.meta.url));
const source = "/home/tim/.openclaw/workspace/releases/speed-phase1-reviewed-r6-20261111";
const expectedBuild = "c49e8cbad84665aadc57323448c013f7c2420fa9cdff3992835164913bb7f161";
const expectedFingerprint = "3d4e7376001274a418390701935b8f474d6973a6ae4f8976ede74fd62e7c1c0d";
const harness = await fs.realpath(process.env.PERF_HARNESS_DIR);
const { verifyFrozenHarness } = await import(pathToFileURL(path.join(harness, "perf/harness-fingerprint.mjs")).href);
const sealed = await verifyFrozenHarness(harness);
if (sealed.harnessFingerprint !== "25dfa8bfb3977677cfdd0340d7de19cf68895cd80000e19d14e4867f36dd41c4") throw Error("Wrong sealed helper provenance");
const socket = process.env.PERF_LAB_SOCKET;
if (!/^\/tmp\/foremanhq-perf-pg\.[^/]+$/.test(socket ?? "")) throw Error("Fresh private DB scope required");
await fs.access(path.join(socket, ".s.PGSQL.55463"));
const privateDb = new URL(process.env.PERF_LAB_DATABASE_URL);
if (privateDb.pathname !== "/foremanhq_perf_lab" || privateDb.searchParams.get("host") !== socket || process.env.DATABASE_URL !== privateDb.href)
  throw Error("Private connection inputs disagree");
const { fingerprintSource, sourceEvidence } = await import(pathToFileURL(path.join(source, "scripts/release/source-fingerprint.mjs")).href);
const original = await fingerprintSource(source);
if (original.sourceFingerprint !== expectedFingerprint) throw Error("Frozen R6 changed");
const canonicalId = (await fs.readFile(path.join(source, ".next-web/BUILD_ID"), "utf8")).trim();
if (canonicalId !== expectedBuild) throw Error("Unexpected R6 build");
const attempt = await fs.mkdtemp(path.join(os.tmpdir(), "foremanhq-next-functional-prepared-"));
const ownFiles = ["next-cache-prepare.mjs", "next-cache-functional.mjs", "next-cache-functional-supervisor.mjs", "next-cache-functional.md"];
const ownHashes = {};
await fs.mkdir(path.join(attempt, "method"));
for (const name of ownFiles) {
  const bytes = await fs.readFile(path.join(here, name));
  ownHashes[name] = sha(bytes);
  await fs.writeFile(path.join(attempt, "method", name), bytes, { mode: 0o444 });
}
const focusedMethod = sha(JSON.stringify({ protocol: "next-cache-functional-v1", syntheticAuth: true,
  timingComparable: false, original: expectedFingerprint, sealed: sealed.harnessFingerprint, ownHashes }));
const output = { protocol: "next-cache-functional-v1", status: "preparing-source-only", syntheticAuthentication: true,
  comparableTimingEvidence: false, productionDatabase: false, sourceBuild: expectedBuild,
  sourceFingerprint: expectedFingerprint, focusedMethod, helperFingerprint: sealed.harnessFingerprint,
  ownHashes, startedAt: new Date().toISOString(), frozenR6: source, privateSocket: socket, variants: [] };
const save = () => fs.writeFile(path.join(attempt, "prepared.json"), JSON.stringify(output, null, 2) + "\n");
try {
  await save();
  for (const label of ["A", "B"]) {
    const log = path.join(attempt, `copy-${label}.log`);
    const text = execFileSync(process.execPath, [path.join(harness, "perf/create-lab-snapshot.mjs")], {
      cwd: harness, timeout: 60_000, encoding: "utf8", env: { ...process.env,
        PERF_SOURCE_ROOT: source, PERF_SOURCE_BUILD_DIST: path.join(source, ".next-web") },
    });
    await fs.writeFile(log, text);
    const root = await fs.realpath(text.trim().split("\n").at(-1));
    if (!root.startsWith("/tmp/foremanhq-speed-app-")) throw Error("Unexpected generated source root");
    const evidence = await sourceEvidence(source, root, expectedBuild);
    // Only original public inputs are frozen here. Generated fixtures/data and
    // Next output remain writable; established config transforms stay explicit.
    for (const row of original.manifest) {
      if (evidence.sourceVerification.allowedLabTransforms.includes(row.name)) continue;
      await fs.chmod(path.join(root, row.name), 0o444);
    }
    const build = sha(focusedMethod + ":fixture:" + label);
    const fixture = JSON.parse(await fs.readFile(path.join(root, "perf/fixtures.json"), "utf8"));
    output.variants.push({ label, root, dist: ".next", build, pid: null, base: null,
      fixtureSha256: sha(JSON.stringify(fixture)), verification: evidence.sourceVerification });
    await save();
  }
  if (output.variants[0].fixtureSha256 !== output.variants[1].fixtureSha256) throw Error("Copies do not share the seeded fixture");
  output.status = "source-verified-not-built";
  output.preparedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ status: output.status, attemptDirectory: attempt, variants: output.variants.map(({ label, root, build }) => ({ label, root, build })) }));
  // Database ownership remains in the caller's sealed database.sh trap. This
  // process never starts a Next server. STOP exits normally and runs that trap.
  await new Promise(resolve => {
    let ended = false;
    const finish = () => { if (ended) return; ended = true; clearInterval(poll); clearTimeout(limit); resolve(); };
    const poll = setInterval(() => fs.access(path.join(attempt, "STOP")).then(finish, () => {}), 1000);
    const limit = setTimeout(finish, 45 * 60_000);
    process.once("SIGTERM", finish); process.once("SIGINT", finish);
  });
  output.owningScopeEndedAt = new Date().toISOString(); await save();
} catch (error) {
  output.status = "failed-preparation"; output.error = error.message;
  await save(); throw error;
}
