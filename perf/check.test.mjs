import { test } from "node:test";
import assert from "node:assert/strict";
import {
  budgets,
  compareReports,
  checkRepeatability,
  READ_PREFLIGHT_PROCEDURES,
} from "./check.mjs";
let reportSequence = 0;
const report = () => {
  const timestamp = new Date(++reportSequence).toISOString();
  return {
    timestamp,
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
        Array.from({ length: 5 }, (_, run) => ({
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
  assert.ok(checkRepeatability(first, second).length);
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
