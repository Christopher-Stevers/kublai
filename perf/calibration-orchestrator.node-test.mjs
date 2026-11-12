// Pure scheduler tests; injected capture callback never opens browser/DB/processes.
import test from "node:test";
import assert from "node:assert/strict";
import { runCalibrationSequence } from "./calibration-orchestrator.mjs";
import { capture, entry } from "./calibrated-policy-fixtures.mjs";
import {
  PROTOCOL_ID,
  POLICY_ID,
  FIXTURE_PRELUDE,
  decodeEntry,
} from "./calibrated-policy.mjs";
const setup = ({
  failed = false,
  persistent = false,
  corrupt = false,
} = {}) => {
  const session = {
    sessionId: "calibration15-unit",
    policyId: POLICY_ID,
    fullRuns: 20,
    controls: 19,
    overallBoundMs: 50 * 60 * 60000,
    sessionPlanSha256: "f".repeat(64),
    sourceBuild: "a".repeat(64),
    sourceFingerprint: "a".repeat(64),
    build: "test-build",
    harnessFingerprint: "c".repeat(64),
    fixturePrelude: FIXTURE_PRELUDE,
  };
  const bundle = {
    status: "incomplete",
    policyId: POLICY_ID,
    sessionPlanSha256: session.sessionPlanSha256,
    baseline: null,
    controls: [],
  };
  let clock = 1000000;
  const calls = [];
  const runStage = async (plan) => {
    calls.push(structuredClone(plan));
    const full = capture({
      role: plan.role,
      baseline: bundle.baseline,
      parent: plan.role === "remeasure" ? bundle.controls.at(-1) : null,
      cells: plan.requestedCells,
    });
    const r = decodeEntry(full.report);
    r.timestamp = new Date(Date.parse(plan.sealedAt) + 100).toISOString();
    r.health.database.windowStartedAt = r.timestamp;
    r.health.database.observedAt = new Date(
      Date.parse(plan.sealedAt) + 500,
    ).toISOString();
    for (const c of r.cellPreludes)
      c.observedAt = new Date(Date.parse(plan.sealedAt) + 200).toISOString();
    if (
      (failed && plan.role === "control") ||
      (persistent && plan.role === "remeasure")
    )
      for (const s of r.samples)
        if (
          (s.journey === "openjob" && s.link === "Site") ||
          (s.journey === "changeqty" && s.link === "Office")
        )
          s.durationMs = 131;
    if (corrupt && plan.role === "control") r.health.database.count = 1;
    const p = entry(plan);
    r.measurement = { ...plan, planSha256: p.sha256 };
    return { report: entry(r), plan: p };
  };
  return {
    session,
    bundle,
    calls,
    runStage,
    persist: () => {},
    now: () => new Date((clock += 1000)).toISOString(),
  };
};
test("twenty complete raw captures only; staged firstpair remains incomplete and resumes fixedB", async () => {
  const s = setup();
  await runCalibrationSequence({ ...s, throughControl: 1 });
  assert.equal(s.calls.length, 2);
  assert.equal(s.bundle.status, "incomplete");
  const fixed = s.bundle.baseline.report.sha256;
  await runCalibrationSequence({ ...s, throughControl: 19 });
  assert.equal(s.calls.length, 20);
  assert.equal(s.bundle.status, "complete");
  assert.equal(s.bundle.baseline.report.sha256, fixed);
  assert.equal(s.calls.filter((p) => p.role === "baseline").length, 1);
});
test("every failed pair gets exactlyone fresh15 confirmation, no Cartesianexpansion/pooling", async () => {
  const s = setup({ failed: true });
  await runCalibrationSequence({ ...s, throughControl: 1 });
  assert.equal(s.calls.length, 3);
  const p = s.calls[2];
  assert.equal(p.attemptIndex, 1);
  assert.deepEqual(p.requestedCells, [
    { journey: "openjob", link: "Site" },
    { journey: "changeqty", link: "Office" },
  ]);
  assert.equal(decodeEntry(s.bundle.controls[0].report).samples.length, 360);
  assert.equal(
    decodeEntry(s.bundle.controls[0].confirmation.report).samples.length,
    30,
  );
});
test("persistent failure stops after soleconfirmation, never secondretry/control2", async () => {
  const s = setup({ failed: true, persistent: true });
  await assert.rejects(() =>
    runCalibrationSequence({ ...s, throughControl: 19 }),
  );
  assert.equal(s.calls.length, 3);
  assert.equal(s.bundle.status, "rejected");
});
test("health/provenance failure stops before anyconfirmation", async () => {
  const s = setup({ failed: true, corrupt: true });
  await assert.rejects(() =>
    runCalibrationSequence({ ...s, throughControl: 19 }),
  );
  assert.equal(s.calls.length, 2);
  assert.equal(s.bundle.status, "rejected");
});
test("failedstage preserves terminalfailure and cannotresetbaseline onresume", async () => {
  const s = setup();
  const real = s.runStage;
  s.runStage = async (p) => {
    if (p.role === "control") throw Error("stage failed");
    return real(p);
  };
  await assert.rejects(() =>
    runCalibrationSequence({ ...s, throughControl: 1 }),
  );
  const fixed = s.bundle.baseline.report.sha256;
  await assert.rejects(() =>
    runCalibrationSequence({ ...s, throughControl: 1 }),
  );
  assert.equal(s.bundle.baseline.report.sha256, fixed);
  assert.equal(s.calls.length, 1);
});
