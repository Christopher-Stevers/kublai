// Pure prospective-plan tests; no browser/server/database.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateCapturePlan, fullCells } from "./capture-plan.mjs";
import { PROTOCOL_ID, FIXTURE_PRELUDE } from "./calibrated-policy.mjs";
const budgets = JSON.parse(
  fs.readFileSync(new URL("./budgets.json", import.meta.url)),
);
const source = {
  sourceBuild: "a".repeat(64),
  sourceFingerprint: "b".repeat(64),
  build: "compiled-lab",
};
const harness = "c".repeat(64);
const plan = () => ({
  protocolId: PROTOCOL_ID,
  durationDefinition: "f9/v2-original-wallclock",
  captureId: "baseline",
  role: "baseline",
  attemptIndex: 0,
  sealedAt: "2026-11-12T00:00:00Z",
  referenceBaselineSha256: null,
  parentFullReportSha256: null,
  ...source,
  harnessFingerprint: harness,
  requestedCells: fullCells(budgets),
  fixturePrelude: FIXTURE_PRELUDE,
});
const options = {
  budgets,
  source,
  harnessFingerprint: harness,
  now: Date.parse("2026-11-12T01:00:00Z"),
};
test("full plan is original link then journey ordering,24cells and360samples", () => {
  const p = validateCapturePlan(plan(), options);
  assert.equal(p.requestedCells.length, 24);
  assert.equal(p.requestedCells.length * 15, 360);
  assert.deepEqual(p.requestedCells.slice(0, 2), [
    { journey: "coldstart", link: "Basement" },
    { journey: "openjob", link: "Basement" },
  ]);
});
test("missing/duplicate/reordered full cell plans fail", () => {
  for (const cells of [
    fullCells(budgets).slice(1),
    [...fullCells(budgets).slice(1), fullCells(budgets)[1]],
    [...fullCells(budgets)].reverse(),
  ])
    assert.throws(() =>
      validateCapturePlan({ ...plan(), requestedCells: cells }, options),
    );
});
test("one confirmation selects exact pairs without Cartesian product", () => {
  const failed = [
    { journey: "openjob", link: "Site" },
    { journey: "changeqty", link: "Office" },
  ];
  const p = {
    ...plan(),
    captureId: "control01-confirmation",
    role: "remeasure",
    attemptIndex: 1,
    referenceBaselineSha256: "d".repeat(64),
    parentFullReportSha256: "e".repeat(64),
    requestedCells: failed,
  };
  assert.equal(
    validateCapturePlan(p, { ...options, expectedFailedCells: failed })
      .requestedCells.length,
    2,
  );
  assert.throws(() =>
    validateCapturePlan(
      {
        ...p,
        requestedCells: [...failed, { journey: "openjob", link: "Office" }],
      },
      { ...options, expectedFailedCells: failed },
    ),
  );
});
test("second retry and confirmation without failures rejected", () => {
  assert.throws(() =>
    validateCapturePlan(
      { ...plan(), role: "remeasure", attemptIndex: 2 },
      options,
    ),
  );
  assert.throws(() =>
    validateCapturePlan(
      {
        ...plan(),
        role: "remeasure",
        attemptIndex: 1,
        requestedCells: [],
        referenceBaselineSha256: "d".repeat(64),
        parentFullReportSha256: "e".repeat(64),
      },
      { ...options, expectedFailedCells: [] },
    ),
  );
});
test("stale source/method/future plan/no prelude rejected", () => {
  for (const change of [
    { sourceBuild: "other" },
    { sourceFingerprint: "other" },
    { build: "other" },
    { harnessFingerprint: "other" },
    { sealedAt: "2027-01-01T00:00:00Z" },
    { fixturePrelude: null },
  ])
    assert.throws(() => validateCapturePlan({ ...plan(), ...change }, options));
});
test("baseline is fixed self-unreferenced;control needs immutable baseline hash", () => {
  assert.throws(() =>
    validateCapturePlan(
      { ...plan(), referenceBaselineSha256: "d".repeat(64) },
      options,
    ),
  );
  assert.throws(() =>
    validateCapturePlan(
      { ...plan(), role: "control", referenceBaselineSha256: null },
      options,
    ),
  );
});
test("timed section and all journey definitions remain frozen f9/v2 byte-identical", () => {
  const current = fs.readFileSync(
      new URL("./run.mjs", import.meta.url),
      "utf8",
    ),
    old = fs.readFileSync(
      "/tmp/foremanhq-perf-method-f9bHR6/perf/run.mjs",
      "utf8",
    );
  const interval = (s) =>
    s.slice(
      s.indexOf("          const start = performance.now();"),
      s.lastIndexOf("\n",s.indexOf("if (pageErrors.length)"))+1,
    );
  assert.equal(interval(current), interval(old));
  assert.equal(
    fs.readFileSync(new URL("./journeys.mjs", import.meta.url), "utf8"),
    fs.readFileSync(
      "/tmp/foremanhq-perf-method-f9bHR6/perf/journeys.mjs",
      "utf8",
    ),
  );
});
