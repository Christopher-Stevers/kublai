// Supplemental R7/R8 experiment. Invokes the frozen driver without modifying it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const output =
  process.env.PERF_COMPARISON_OUTPUT ?? "openjob-press-comparison.json";
const rawDirectory = path.resolve(
  process.env.PERF_COMPARISON_RAW ?? "openjob-press-fragments",
);
const driver = fileURLToPath(import.meta.url);
const sha = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const frozen = config.harnessRoot;
const { verifyFrozenHarness } = await import(
  pathToFileURL(path.join(frozen, "perf/harness-fingerprint.mjs"))
);
const { fingerprintSource } = await import(
  pathToFileURL(path.join(frozen, "scripts/release/source-fingerprint.mjs"))
);
const before = await verifyFrozenHarness(frozen);
if (
  before.harnessFingerprint !==
  "25dfa8bfb3977677cfdd0340d7de19cf68895cd80000e19d14e4867f36dd41c4"
)
  throw Error("Exact frozen method required");
if (fs.statSync(driver).mode & 0o222)
  throw Error("Coordinator must be a frozen read-only copy");
fs.mkdirSync(rawDirectory, { recursive: true });
const report = {
  kind: "supplemental-controlled-source-comparison",
  protocol: "openjob-default-press-comparison-v1",
  status: "incomplete",
  acceptedGateEvidence: false,
  startedAt: new Date().toISOString(),
  coordinatorBefore: sha(driver),
  frozenMethodBefore: before.harnessFingerprint,
  roles: ["r7", "r8"],
  blocks: ["r7", "r8", "r8", "r7", "r7", "r8", "r8", "r7"],
  samplesPerBlock: 5,
  samplesPerSource: 20,
  link: "Office",
  sources: {},
  fragments: [],
  samples: [],
  limitations: [
    "Original sealed run.mjs and journeys.mjs execute each five-sample block unchanged; default exact first job-name click, destination assertion and two-rAF completion remain intact.",
    "No continuous rAF/MutationObserver, force option, added browser timing probe or app-source instrumentation.",
    "One new browser per five-sample block is untimed and differs from a full-matrix single browser lifetime. Each context remains fresh as in the original method.",
    "Two synthetic app servers run concurrently; shared production/OS background activity remains uncontrolled.",
    "Office only; descriptive source/block/paired distributions, not a full gate, physical pixels, statistical p95 or component-cause proof.",
    "R7 full-matrix failures and all prior evidence remain unchanged; no acceptance threshold is introduced.",
  ],
};
const write = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
const health = (s) => {
  const text = fs.readFileSync(
    path.join(s.databaseDirectory, "server.log"),
    "utf8",
  );
  return {
    errors: (text.match(/^.*\bERROR:/gm) ?? []).length,
    fatals: (text.match(/^.*\bFATAL:/gm) ?? []).length,
  };
};
const digests = {};
for (const role of report.roles) {
  const s = config[role],
    base = new URL(s.base);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
    base.pathname !== "/"
  )
    throw Error("Loopback app root required");
  if (
    !s.databaseDirectory.startsWith("/tmp/foremanhq-perf-pg.") ||
    !fs.existsSync(path.join(s.databaseDirectory, ".s.PGSQL.55463"))
  )
    throw Error("Live private socket required");
  if (
    !fs.realpathSync(s.snapshot).startsWith("/tmp/foremanhq-speed-app-") ||
    !fs.existsSync(path.join(s.snapshot, "PERF_LAB_ONLY"))
  )
    throw Error("Marked synthetic compiled snapshot required");
  const source = JSON.parse(
      fs.readFileSync(path.join(s.snapshot, "source-evidence.json")),
    ),
    preflight = JSON.parse(fs.readFileSync(s.preflight));
  const required = [
    "user.getMe",
    "notifications.identity",
    "push.identity",
    "job.getJob",
    "materialList.getMaterialList",
    "materialList.getOrderById",
    "drawings.listSets",
    "drawings.getSet",
    "drawingsWorkspace.get",
    "drawingsWorkspace.changes",
    "chat.getOverview",
    "chat.history",
    "rooms.getJobRoomCount",
    "notifications.overview",
  ];
  if (
    !/^[a-f0-9]{64}$/.test(s.expectedSourceBuild ?? "") ||
    !/^[a-f0-9]{64}$/.test(s.expectedSourceFingerprint ?? "") ||
    source.sourceBuild !== s.expectedSourceBuild ||
    source.sourceFingerprint !== s.expectedSourceFingerprint ||
    preflight.status !== "passed" ||
    preflight.build !== s.expectedLabBuild ||
    preflight.sourceBuild !== source.sourceBuild ||
    preflight.sourceFingerprint !== source.sourceFingerprint ||
    required.some(
      (name) =>
        !preflight.results.some(
          (x) => x.procedure === name && x.status === "ok",
        ),
    )
  )
    throw Error("Exact source/preflight identity required");
  if (
    fs.readFileSync(path.join(s.snapshot, ".next/BUILD_ID"), "utf8").trim() !==
    s.expectedLabBuild
  )
    throw Error("Compiled app build mismatch");
  const attestation = await fetch(new URL("/api/perf-lab", base), {
    signal: AbortSignal.timeout(10000),
  }).then((r) => r.json());
  if (
    attestation.provenance !== "isolated-seeded-app" ||
    attestation.productionDatabase !== false
  )
    throw Error("Synthetic app attestation required");
  const h = health(s);
  if (h.errors || h.fatals)
    throw Error("Private database error before comparison");
  digests[role] = await fingerprintSource(s.canonicalSource);
  if (digests[role].sourceFingerprint !== s.expectedSourceFingerprint)
    throw Error("Canonical source changed");
  report.sources[role] = {
    sourceBuild: source.sourceBuild,
    sourceFingerprint: source.sourceFingerprint,
    labBuild: preflight.build,
    preflight,
    healthBefore: h,
  };
}
const left = new Map(digests.r7.manifest.map((x) => [x.name, x.sha256])),
  right = new Map(digests.r8.manifest.map((x) => [x.name, x.sha256]));
const changed = [...new Set([...left.keys(), ...right.keys()])]
  .filter((name) => left.get(name) !== right.get(name))
  .sort();
const allowed = [
  "src/app/jobs/JobsClient.tsx",
  "src/components/ui/pressable-card.tsx",
  "src/hooks/use-press.ts",
].sort();
if (JSON.stringify(changed) !== JSON.stringify(allowed))
  throw Error(
    "R8 must differ from R7 at the exact three reviewed production paths only",
  );
report.controlledSourceDifference = {
  changed,
  sourceFileCounts: {
    r7: digests.r7.sourceFileCount,
    r8: digests.r8.sourceFileCount,
  },
  scope:
    "Frozen source-fingerprint inputs; separate canonical proof covers all unaffected public files.",
};
write();
let activeChild;
let aborted = false;
const stop = () => {
  aborted = true;
  activeChild?.kill("SIGTERM");
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
const totalTimer = setTimeout(stop, 480000);
try {
  for (let block = 0; block < report.blocks.length; block++) {
    if (aborted) throw Error("Comparison interrupted");
    const role = report.blocks[block],
      s = config[role],
      file = path.join(rawDirectory, `${block + 1}-${role}.json`),
      log = path.join(rawDirectory, `${block + 1}-${role}.log`);
    report.active = { block: block + 1, role };
    write();
    const env = {
      ...process.env,
      PERF_HARNESS_DIR: frozen,
      PERF_BASE_URL: s.base,
      PERF_FIXTURES: path.join(s.snapshot, "perf/fixtures.json"),
      PERF_BUILD: s.expectedLabBuild,
      PERF_LAB_SOCKET: s.databaseDirectory,
      PERF_JOURNEY_ADAPTER: path.join(frozen, "perf/journeys.mjs"),
      PERF_PILOT: "1",
      PERF_LINKS: "Office",
      PERF_JOURNEYS: "openjob",
      PERF_RUNS: "5",
      PERF_SHEET_PROTOCOL: "ready-then-pinch-v2",
      PERF_OUTPUT: file,
    };
    delete env.PERF_STATIC_REPORT;
    delete env.PERF_DIAGNOSTICS;
    const descriptor = fs.openSync(log, "w");
    let childTimer, killTimer;
    const result = await new Promise((resolve, reject) => {
      activeChild = spawn(
        process.execPath,
        [path.join(frozen, "perf/run.mjs")],
        { cwd: s.snapshot, env, stdio: ["ignore", descriptor, descriptor] },
      );
      childTimer = setTimeout(() => {
        activeChild?.kill("SIGTERM");
        killTimer = setTimeout(() => activeChild?.kill("SIGKILL"), 15000);
      }, 90000);
      activeChild.once("error", reject);
      activeChild.once("exit", (code, signal) => resolve({ code, signal }));
    }).finally(() => {
      clearTimeout(childTimer);
      clearTimeout(killTimer);
      fs.closeSync(descriptor);
      activeChild = undefined;
    });
    if (!fs.existsSync(file)) {
      report.fragments.push({
        block: block + 1,
        role,
        result,
        status: "no-report",
      });
      write();
      throw Error("Frozen child did not emit report");
    }
    const raw = JSON.parse(fs.readFileSync(file));
    report.fragments.push({
      block: block + 1,
      role,
      result,
      path: file,
      sha256: sha(file),
      samples: raw.samples?.length ?? 0,
      status: raw.status,
    });
    write();
    if (
      result.code !== 0 ||
      raw.status !== "complete" ||
      raw.samples.length !== 5 ||
      raw.sourceBuild !== s.expectedSourceBuild ||
      raw.sourceFingerprint !== s.expectedSourceFingerprint ||
      raw.build !== s.expectedLabBuild ||
      raw.harnessFingerprint !== before.harnessFingerprint ||
      raw.harnessVerification.before !== before.harnessFingerprint ||
      raw.harnessVerification.after !== before.harnessFingerprint ||
      raw.health.database.count !== 0 ||
      raw.health.database.fatalCount !== 0 ||
      raw.samples.some(
        (x) =>
          x.journey !== "openjob" ||
          x.link !== "Office" ||
          x.variant !== "visited" ||
          !Number.isFinite(x.durationMs),
      )
    )
      throw Error("Frozen child failed source/method/sample/health contract");
    for (const sample of raw.samples)
      report.samples.push({ role, block: block + 1, ...sample });
    write();
  }
  report.status = "complete";
  delete report.active;
} catch (error) {
  report.status = aborted ? "interrupted" : "failed";
  report.failure = {
    ...report.active,
    message:
      "Controlled comparison stopped; retain fragments/logs and original gate unchanged.",
  };
  process.exitCode = aborted ? 143 : 1;
} finally {
  clearTimeout(totalTimer);
  process.removeListener("SIGTERM", stop);
  process.removeListener("SIGINT", stop);
  for (const role of report.roles) {
    report.sources[role].healthAfter = health(config[role]);
    if (
      report.sources[role].healthAfter.errors ||
      report.sources[role].healthAfter.fatals
    ) {
      report.status = "failed";
      process.exitCode = 1;
    }
  }
  report.coordinatorAfter = sha(driver);
  report.frozenMethodAfter = (
    await verifyFrozenHarness(frozen)
  ).harnessFingerprint;
  report.endedAt = new Date().toISOString();
  write();
}
