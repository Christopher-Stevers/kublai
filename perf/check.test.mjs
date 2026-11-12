import { test } from "node:test";
import assert from "node:assert/strict";
import {
  budgets,
  compareReports,
  checkRepeatability,
  READ_PREFLIGHT_PROCEDURES,
} from "./check.mjs";
import {
  HARNESS_FILES,
  HARNESS_FINGERPRINT_ALGORITHM,
} from "./harness-fingerprint.mjs";
let reportSequence = 0;
const report = () => {
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
test("unchanged report passes; incomplete and invented provenance fail", () => {
  assert.deepEqual(compareReports(report(), report()), []);
  const missing = report();
  missing.samples.pop();
  assert.ok(compareReports(report(), missing).length);
  const fake = report();
  fake.provenance = "synthetic-demonstration";
  assert.ok(compareReports(report(), fake).length);
});
test("planted 100ms tap, 30KB script and poll regressions fail", () => {
  for (const mutate of [
    (r) => {
      r.samples
        .filter((s) => s.journey === "openjob")
        .forEach((s) => (s.durationMs += 100));
    },
    (r) => (r.static.sharedGzipBytes += 30000),
    (r) => r.static.idlePolls++,
  ]) {
    const next = report();
    mutate(next);
    assert.ok(compareReports(report(), next).length);
  }
});

test("independent Phase 0 runs require same build and medians within ten percent", () => {
  const first = report(),
    second = report();
  assert.deepEqual(checkRepeatability(first, second), []);
  assert.ok(checkRepeatability(first, first).length);
  second.samples.forEach((sample) => (sample.durationMs = 89));
  assert.deepEqual(checkRepeatability(first, second), []);
  const mismatch = report();
  mismatch.build = "different-build";
  assert.ok(checkRepeatability(first, mismatch).length);
});

test("fixture and database failures cannot become accepted timing evidence", () => {
  for (const mutate of [
    (r) => (r.health.preflight.status = "failed"),
    (r) => (r.health.preflight.sourceBuild = "wrong"),
    (r) => (r.health.database.count = 1),
    (r) => (r.health.fixtureSchema.tableCount = 0),
  ]) {
    const next = report();
    mutate(next);
    assert.ok(compareReports(report(), next).length);
  }
});

test("different journey protocols cannot be compared", () => {
  const first = report(),
    next = report();
  first.protocol = { id: "early-pinch-v1" };
  next.protocol = { id: "ready-then-pinch-v2" };
  assert.ok(compareReports(first, next).length);
  assert.ok(checkRepeatability(first, next).length);
});

test("changed frozen harness or mismatched method blocks comparison", () => {
  const first = report(),
    next = report();
  next.harnessFingerprint = "d".repeat(64);
  next.harnessVerification = {
    before: next.harnessFingerprint,
    after: next.harnessFingerprint,
    immutable: true,
  };
  assert.ok(compareReports(first, next).length);
  assert.ok(checkRepeatability(first, next).length);
  next.harnessVerification.after = "e".repeat(64);
  assert.ok(compareReports(report(), next).length);
});

test("new rule uses15 samples and requires both strict thresholds", () => {
  const a = report(),
    b = report();
  b.samples.forEach((s) => (s.durationMs = 117));
  assert.deepEqual(compareReports(a, b), []);
  b.samples.forEach((s) => (s.durationMs = 118));
  assert(compareReports(a, b).length);
  a.samples.forEach((s) => (s.durationMs = 200));
  b.samples.forEach((s) => (s.durationMs = 220));
  assert.deepEqual(compareReports(a, b), []);
  b.samples.forEach((s) => (s.durationMs = 221));
  assert(compareReports(a, b).length);
});
