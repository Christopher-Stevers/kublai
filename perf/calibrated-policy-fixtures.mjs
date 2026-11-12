// Test fixtures only. Never accepted as measured evidence.
import { budgets, READ_PREFLIGHT_PROCEDURES } from "./check.mjs";
import {
  HARNESS_FILES,
  HARNESS_FINGERPRINT_ALGORITHM,
} from "./harness-fingerprint.mjs";
let reportSequence = 0;
export const report = () => {
  const timestamp = new Date(++reportSequence).toISOString();
  return {
    timestamp,
    harnessFingerprint: "c".repeat(64),
    harnessFingerprintAlgorithm: HARNESS_FINGERPRINT_ALGORITHM,
    harnessFileCount: HARNESS_FILES.length,
    harnessVerification: {
      before: "c".repeat(64),
      after: "c".repeat(64),
      immutable: true,
    },
    harnessToolchain: {
      node: "test-node",
      playwright: "test-playwright",
      browser: "test-browser",
    },
    sourceBuild: "a".repeat(64),
    sourceFingerprint: "b".repeat(64),
    health: {
      preflight: {
        status: "passed",
        build: "test-build",
        sourceBuild: "a".repeat(64),
        sourceFingerprint: "b".repeat(64),
        results: READ_PREFLIGHT_PROCEDURES.map((procedure) => ({
          procedure,
          status: "ok",
        })),
      },
      fixtureSchema: {
        status: "source-declared-schemas-created",
        sourceBuild: "a".repeat(64),
        sourceFingerprint: "b".repeat(64),
        moduleCount: 16,
        tableCount: 113,
      },
      database: {
        count: 0,
        fatalCount: 0,
        windowStartedAt: timestamp,
        observedAt: timestamp,
      },
    },
    version: 1,
    build: "test-build",
    provenance: "isolated-seeded-app",
    cpuSlowdown: 4,
    static: {
      sharedGzipBytes: 100,
      screenGzipBytes: 100,
      deployGzipBytes: 100,
      idlePolls: 0,
    },
    samples: budgets.journeys.flatMap((journey) =>
      Object.keys(budgets.links).flatMap((link) =>
        Array.from({ length: budgets.runs }, (_, run) => ({
          run,
          variant: ["openjob", "switchjobtabs", "openmateriallist"].includes(
            journey,
          )
            ? "visited"
            : "operation",
          journey,
          link,
          durationMs: 100,
        })),
      ),
    ),
  };
};
import { createHash } from "node:crypto";
import {
  POLICY_ID,
  ALL_CELLS,
  FIXTURE_PRELUDE,
  SEMANTIC_FIXTURE,
} from "./calibrated-policy.mjs";
import { LAB_TRANSFORM_PATHS } from "../scripts/release/source-fingerprint.mjs";
export const entry = (value) => {
  const raw = JSON.stringify(value);
  return { raw, sha256: createHash("sha256").update(raw).digest("hex") };
};
let clock = 100000;
export function capture({
  role = "baseline",
  baseline = null,
  parent = null,
  cells = ALL_CELLS,
  value = 100,
  source = "a".repeat(64),
} = {}) {
  const r = report();
  const start = (clock += 1000);
  r.timestamp = new Date(start).toISOString();
  r.health.database.windowStartedAt = r.timestamp;
  r.health.database.observedAt = new Date(start + 100).toISOString();
  r.sourceBuild = source;
  r.sourceFingerprint = source;
  r.static.build = source;
  r.health.preflight.sourceBuild = source;
  r.health.preflight.sourceFingerprint = source;
  r.health.fixtureSchema.sourceBuild = source;
  r.health.fixtureSchema.sourceFingerprint = source;
  r.protocol = { id: POLICY_ID };
  r.sourceFileCount = 20;
  r.sourceBinding = {
    method: "frozen-release-inputs-sha256",
    algorithm: "foremanhq-lab-source-v1",
    sourceBuild: source,
  };
  r.sourceVerification = {
    stage: "after-lab-transforms",
    unchangedFilesChecked: 20 - LAB_TRANSFORM_PATHS.length,
    allowedLabTransforms: LAB_TRANSFORM_PATHS,
  };
  r.samples = r.samples
    .filter((s) =>
      cells.some((c) => c.journey === s.journey && c.link === s.link),
    )
    .map((s) => ({ ...s, durationMs: value }));
  const plan = {
    protocolId: POLICY_ID,
    durationDefinition: "f9/v2-original-wallclock",
    captureId: "capture-" + start,
    role,
    attemptIndex: role === "remeasure" ? 1 : 0,
    referenceBaselineSha256: baseline?.report.sha256 ?? null,
    parentFullReportSha256: parent?.report.sha256 ?? null,
    requestedCells: cells,
    sealedAt: new Date(start - 100).toISOString(),
    sourceBuild: source,
    sourceFingerprint: source,
    build: r.build,
    harnessFingerprint: r.harnessFingerprint,
    fixturePrelude: FIXTURE_PRELUDE,
  };
  r.status = "complete";
  r.cellPreludes = cells.map((c) => ({
    ...c,
    status: "passed",
    stateVerified: true,
    restoreCompleted: true,
    drain: { priorServerAbsent: true },
    serverIdentity: { pid: 123, startTime: "12345" },
    observedAt: new Date(start + 50).toISOString(),
    algorithm: FIXTURE_PRELUDE.algorithm,
    semanticFixture: SEMANTIC_FIXTURE,
    resetCompleted: true,
    resetHelperSha256: FIXTURE_PRELUDE.resetHelperSha256,
    readPreflightCount: 14,
    sourceBuild: source,
    fixturePrelude: FIXTURE_PRELUDE,
    seedSnapshotSha256: "1".repeat(64),
    stateSha256: "2".repeat(64),
    preflightSha256: "3".repeat(64),
    privateDatabase: {
      socket: "/tmp/foremanhq-perf-pg.synthetic",
      port: 55463,
      database: "foremanhq_perf_lab",
      otherSessions: 0,
    },
  }));
  const p = entry(plan);
  r.measurement = { ...plan, planSha256: p.sha256 };
  return { report: entry(r), plan: p };
}
export function calibration() {
  const baseline = capture();
  return {
    status: "complete",
    policyId: POLICY_ID,
    baseline,
    controls: Array.from({ length: 19 }, () =>
      capture({ role: "control", baseline }),
    ),
  };
}
export function modify(c, fn) {
  const r = JSON.parse(c.report.raw);
  fn(r);
  c.report = entry(r);
  return c;
}
