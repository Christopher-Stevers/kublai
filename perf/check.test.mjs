import { test } from "node:test";
import assert from "node:assert/strict";
import { budgets, compareReports } from "./check.mjs";
const report = () => ({
  version: 1,
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
        journey,
        link,
        durationMs: 100,
      })),
    ),
  ),
});
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
