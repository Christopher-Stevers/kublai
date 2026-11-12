import { test } from "node:test";
import assert from "node:assert/strict";
import { median, timingFails } from "./check.mjs";
import {
  evaluateCalibratedRelease,
  validateCalibration,
  failingCells,
  decodeEntry,
  evaluateCalibrationProgress,
  validateInitialCapture,
} from "./calibrated-policy.mjs";
import {
  capture,
  calibration,
  modify,
  entry,
} from "./calibrated-policy-fixtures.mjs";
const setup = () => {
  const bundle = calibration();
  const reference = {
    baseline: bundle.baseline,
    repeat: bundle.controls.at(-1),
  };
  const candidate = capture({
    role: "candidate",
    baseline: reference.baseline,
    source: "b".repeat(64),
  });
  return { bundle, reference, candidate };
};
test("strict dual threshold, equality and fifteen-sample median index7", () => {
  assert.equal(
    median([0, 1, 2, 3, 4, 5, 6, 700, 800, 900, 1000, 1100, 1200, 1300, 1400]),
    700,
  );
  assert.equal(timingFails(100, 117), false);
  assert.equal(timingFails(100, 117.001), true);
  assert.equal(timingFails(200, 220), false);
  assert.equal(timingFails(200, 220.001), true);
  assert.equal(timingFails(100, 0), false);
  assert.equal(timingFails(NaN, 200), false);
});
test("calibration requires twenty internally bound complete runs, faster controls pass", () => {
  const { bundle, reference, candidate } = setup();
  assert(evaluateCalibratedRelease(bundle, candidate, reference).passed);
  modify(bundle.controls[0], (r) =>
    r.samples.forEach((s) => (s.durationMs = 10)),
  );
  assert.deepEqual(validateCalibration(bundle).errors, []);
  for (const count of [0, 18, 20]) {
    const b = calibration();
    b.controls = b.controls.slice(0, count);
    if (count === 20) b.controls.push(b.controls[0]);
    assert.throws(() => validateCalibration(b));
  }
  const b = calibration();
  b.status = "running";
  assert.throws(() => validateCalibration(b));
});
test("one exact fresh confirmation can resolve first failure without pooling", () => {
  const { bundle, reference, candidate } = setup();
  modify(candidate, (r) =>
    r.samples
      .filter((s) => s.journey === "openjob" && s.link === "Office")
      .forEach((s) => (s.durationMs = 118)),
  );
  const cells = failingCells(
    decodeEntry(reference.baseline.report),
    decodeEntry(candidate.report),
  );
  assert.equal(cells.length, 1);
  assert.throws(
    () => evaluateCalibratedRelease(bundle, candidate, reference),
    /confirmation required/,
  );
  candidate.confirmation = capture({
    role: "remeasure",
    baseline: reference.baseline,
    parent: candidate,
    cells,
    value: 100,
    source: "b".repeat(64),
  });
  assert(evaluateCalibratedRelease(bundle, candidate, reference).passed);
  modify(candidate.confirmation, (r) =>
    r.samples.forEach((s) => (s.durationMs = 118)),
  );
  assert.equal(
    evaluateCalibratedRelease(bundle, candidate, reference).passed,
    false,
  );
});
test("tampering, extra retries/cells and wrong parent/source/method fail closed", () => {
  for (const change of [
    (c) => (c.report.raw += " "),
    (c) => modify(c, (r) => r.samples.pop()),
    (c) =>
      modify(
        c,
        (r) => (r.measurement.referenceBaselineSha256 = "x".repeat(64)),
      ),
    (c) => modify(c, (r) => (r.harnessFingerprint = "d".repeat(64))),
    (c) => {
      c.confirmation = capture({ role: "remeasure" });
    },
  ]) {
    const { bundle, reference, candidate } = setup();
    change(candidate);
    assert.throws(() =>
      evaluateCalibratedRelease(bundle, candidate, reference),
    );
  }
  const b = calibration();
  b.controls[1] = b.controls[0];
  assert.throws(() => validateCalibration(b), /Duplicate/);
});
test("timing confirmation cannot bypass unchanged byte limits or missing active pair", () => {
  const { bundle, reference, candidate } = setup();
  modify(candidate, (r) => r.static.deployGzipBytes++);
  assert.equal(
    evaluateCalibratedRelease(bundle, candidate, reference).passed,
    false,
  );
  assert.throws(
    () => evaluateCalibratedRelease(bundle, candidate),
    /active-source/,
  );
});
test("method calibration is reusable across sources but active source pair remains exact", () => {
  const bundle = calibration(),
    baseline = capture({ source: "d".repeat(64) }),
    repeat = capture({ role: "control", baseline, source: "d".repeat(64) }),
    candidate = capture({
      role: "candidate",
      baseline,
      source: "e".repeat(64),
    });
  assert(
    evaluateCalibratedRelease(bundle, candidate, { baseline, repeat }).passed,
  );
  modify(repeat, (r) => (r.sourceBuild = "f".repeat(64)));
  assert.throws(() =>
    evaluateCalibratedRelease(bundle, candidate, { baseline, repeat }),
  );
});
test("multi-cell confirmation exactness, stale plan, coherent source and second retry rejection", () => {
  for (const mutate of [
    (c) => {
      const r = decodeEntry(c.confirmation.report);
      r.samples = r.samples.filter((s) => s.link === "Office");
      c.confirmation.report = entry(r);
    },
    (c) => {
      const p = decodeEntry(c.confirmation.plan);
      p.sealedAt = decodeEntry(c.plan).sealedAt;
      c.confirmation.plan = entry(p);
      modify(c.confirmation, (r) => {
        r.measurement.sealedAt = p.sealedAt;
        r.measurement.planSha256 = c.confirmation.plan.sha256;
      });
    },
    (c) => {
      c.confirmation = capture({
        role: "remeasure",
        baseline: c._baseline,
        parent: c,
        cells: c._cells,
        source: "c".repeat(64),
      });
    },
    (c) => {
      c.confirmation.confirmation = c.confirmation;
    },
    (c) =>
      modify(c.confirmation, (r) => {
        r.samples[1].run = r.samples[0].run;
      }),
    (c) =>
      modify(c.confirmation, (r) => {
        r.samples[0].durationMs = -1;
      }),
  ]) {
    const { bundle, reference, candidate } = setup();
    modify(candidate, (r) =>
      r.samples
        .filter(
          (s) => s.journey === "openjob" && ["Office", "Site"].includes(s.link),
        )
        .forEach((s) => (s.durationMs = 118)),
    );
    const cells = failingCells(
      decodeEntry(reference.baseline.report),
      decodeEntry(candidate.report),
    );
    assert.equal(cells.length, 2);
    candidate.confirmation = capture({
      role: "remeasure",
      baseline: reference.baseline,
      parent: candidate,
      cells,
      source: "b".repeat(64),
    });
    candidate._baseline = reference.baseline;
    candidate._cells = cells;
    mutate(candidate);
    assert.throws(() =>
      evaluateCalibratedRelease(bundle, candidate, reference),
    );
  }
});

test("initial idle proof remains authoritative when confirmation timestamps differ", () => {
  const { bundle, reference, candidate } = setup();
  modify(candidate, (r) => {
    r.static.idleEvidence = { startedAt: "initial" };
    r.samples
      .filter((s) => s.journey === "openjob" && s.link === "Office")
      .forEach((s) => (s.durationMs = 118));
  });
  const cells = failingCells(
    decodeEntry(reference.baseline.report),
    decodeEntry(candidate.report),
  );
  candidate.confirmation = capture({
    role: "remeasure",
    baseline: reference.baseline,
    parent: candidate,
    cells,
    source: "b".repeat(64),
  });
  modify(candidate.confirmation, (r) => {
    r.static.idleEvidence = { startedAt: "subset-no-new-idle" };
  });
  assert(evaluateCalibratedRelease(bundle, candidate, reference).passed);
  modify(candidate.confirmation, (r) => r.static.idlePolls++);
  assert.throws(() => evaluateCalibratedRelease(bundle, candidate, reference));
});
test("all full plans need the supported fixture prelude before any retry exists", () => {
  const b = calibration();
  const p = decodeEntry(b.baseline.plan);
  delete p.fixturePrelude;
  b.baseline.plan = entry(p);
  modify(b.baseline, (r) => {
    delete r.measurement.fixturePrelude;
    r.measurement.planSha256 = b.baseline.plan.sha256;
  });
  assert.throws(() => validateCalibration(b), /prelude/);
});

test("failed/aborted complete-shaped reports never pass at any role", () => {
  for (const role of ["baseline", "control", "candidate"]) {
    const { bundle, reference, candidate } = setup();
    const c =
      role === "baseline"
        ? bundle.baseline
        : role === "control"
          ? bundle.controls[0]
          : candidate;
    modify(c, (r) => (r.status = "failed"));
    assert.throws(
      () => evaluateCalibratedRelease(bundle, candidate, reference),
      /complete status/,
    );
  }
  const { bundle, reference, candidate } = setup();
  modify(candidate, (r) =>
    r.samples
      .filter((s) => s.journey === "openjob" && s.link === "Office")
      .forEach((s) => (s.durationMs = 118)),
  );
  const cells = failingCells(
    decodeEntry(reference.baseline.report),
    decodeEntry(candidate.report),
  );
  candidate.confirmation = capture({
    role: "remeasure",
    baseline: reference.baseline,
    parent: candidate,
    cells,
    source: "b".repeat(64),
  });
  modify(candidate.confirmation, (r) => (r.status = "aborted"));
  assert.throws(
    () => evaluateCalibratedRelease(bundle, candidate, reference),
    /complete status/,
  );
});
test("prefix progress cannot authorize a candidate and stops on persistent failure", () => {
  const b = calibration();
  b.status = "incomplete";
  b.controls = b.controls.slice(0, 1);
  assert.equal(evaluateCalibrationProgress(b).releaseEligible, false);
  assert.deepEqual(evaluateCalibrationProgress(b).errors, []);
  assert.throws(() => validateCalibration(b));
  modify(b.controls[0], (r) => (r.health.database.count = 1));
  assert.throws(() => evaluateCalibrationProgress(b));
});

test("candidate must start after completed method calibration, actual report protocol enforced", () => {
  const early = capture({ role: "candidate" }),
    { bundle, reference, candidate } = setup();
  // Coherently date candidate and prospective plan earlier than final calibration.
  const r = decodeEntry(candidate.report),
    p = decodeEntry(candidate.plan),
    before = decodeEntry(bundle.controls[0].report).timestamp;
  r.timestamp = before;
  r.cellPreludes.forEach(
    (c) => (c.observedAt = new Date(Date.parse(before) + 50).toISOString()),
  );
  r.health.database.windowStartedAt = before;
  r.health.database.observedAt = new Date(
    Date.parse(before) + 100,
  ).toISOString();
  p.sealedAt = new Date(Date.parse(before) - 100).toISOString();
  r.measurement.sealedAt = p.sealedAt;
  candidate.plan = entry(p);
  r.measurement.planSha256 = candidate.plan.sha256;
  candidate.report = entry(r);
  assert.throws(
    () => evaluateCalibratedRelease(bundle, candidate, reference),
    /calibration|independent/,
  );
  const next = setup();
  modify(next.candidate, (x) => (x.protocol = { id: "ready-then-pinch-v2" }));
  assert.throws(
    () =>
      evaluateCalibratedRelease(next.bundle, next.candidate, next.reference),
    /Actual report protocol/,
  );
});
test("per-cell declarations alone cannot replace successful bound prelude certificates", () => {
  for (const mutate of [
    (r) => r.cellPreludes.pop(),
    (r) => (r.cellPreludes[0].stateVerified = false),
    (r) => (r.cellPreludes[0].sourceBuild = "bad"),
    (r) => (r.cellPreludes[0].seedSnapshotSha256 = "bad"),
    (r) => (r.cellPreludes[0].journey = "unknown"),
  ]) {
    const { bundle, reference, candidate } = setup();
    modify(candidate, mutate);
    assert.throws(() =>
      evaluateCalibratedRelease(bundle, candidate, reference),
    );
  }
});

test("initial screen validates baseline and blocks health/static failures before retries", () => {
  const { bundle, reference, candidate } = setup();
  assert.equal(validateInitialCapture(bundle.baseline).releaseEligible, false);
  assert.deepEqual(
    validateInitialCapture(candidate, reference.baseline).errors,
    [],
  );
  modify(candidate, (r) => r.static.sharedGzipBytes++);
  assert(validateInitialCapture(candidate, reference.baseline).errors.length);
  modify(candidate, (r) => r.health.database.count++);
  assert.throws(() => validateInitialCapture(candidate, reference.baseline));
});
test("stale/reset/drain/server identity evidence cannot certify a restored cell", () => {
  for (const mutate of [
    (r) => (r.cellPreludes[0].observedAt = "1970-01-01T00:00:00Z"),
    (r) => (r.cellPreludes[0].restoreCompleted = false),
    (r) => (r.cellPreludes[0].drain.priorServerAbsent = false),
    (r) => (r.cellPreludes[0].serverIdentity.startTime = ""),
    (r) =>
      (r.cellPreludes[0].privateDatabase.socket =
        "/tmp/foremanhq-perf-pg.other"),
  ]) {
    const { bundle, reference, candidate } = setup();
    modify(candidate, mutate);
    assert.throws(() =>
      evaluateCalibratedRelease(bundle, candidate, reference),
    );
  }
});
