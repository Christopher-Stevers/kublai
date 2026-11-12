// Prospective15-sample selection/provenance only; never changes a journey timer.
import fs from "node:fs";
import { createHash } from "node:crypto";
import {
  PROTOCOL_ID,
  FIXTURE_PRELUDE,
  failingCells,
} from "./calibrated-policy.mjs";
import { validateReport } from "./check.mjs";
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export const fullCells = (budgets) =>
  Object.keys(budgets.links).flatMap((link) =>
    budgets.journeys.map((journey) => ({ journey, link })),
  );
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function validateCapturePlan(
  plan,
  {
    budgets,
    source,
    harnessFingerprint,
    now = Date.now(),
    expectedFailedCells,
  },
) {
  if (
    !hex(plan.sourceBuild) ||
    !hex(plan.sourceFingerprint) ||
    !hex(plan.harnessFingerprint) ||
    typeof plan.build !== "string" ||
    !plan.build ||
    plan.build === "unknown"
  )
    throw Error("Explicit source/method/build identities required");
  if (
    plan.protocolId !== PROTOCOL_ID ||
    plan.durationDefinition !== "f9/v2-original-wallclock" ||
    typeof plan.captureId !== "string" ||
    !plan.captureId ||
    !Number.isFinite(Date.parse(plan.sealedAt)) ||
    Date.parse(plan.sealedAt) >= now
  )
    throw Error("Invalid prospective capture identity/protocol");
  for (const k of ["sourceBuild", "sourceFingerprint", "build"])
    if (plan[k] !== source[k])
      throw Error("Capture source/build differs: " + k);
  if (plan.harnessFingerprint !== harnessFingerprint)
    throw Error("Capture harness differs");
  if (!same(plan.fixturePrelude, FIXTURE_PRELUDE))
    throw Error("Declared identical fixture prelude required");
  if (
    !same(
      plan.requestedCells,
      plan.attemptIndex === 0 ? fullCells(budgets) : expectedFailedCells,
    ) ||
    !Array.isArray(plan.requestedCells) ||
    !plan.requestedCells.length ||
    new Set(plan.requestedCells.map((c) => c.journey + "/" + c.link)).size !==
      plan.requestedCells.length
  )
    throw Error("Exact ordered cell-pair plan required");
  if (plan.attemptIndex === 0) {
    if (
      !["baseline", "control", "candidate"].includes(plan.role) ||
      plan.parentFullReportSha256 != null
    )
      throw Error("Full capture stage differs");
  } else if (
    plan.attemptIndex !== 1 ||
    plan.role !== "remeasure" ||
    !hex(plan.parentFullReportSha256)
  )
    throw Error("Only one confirmation stage permitted");
  if (plan.role === "baseline") {
    if (plan.referenceBaselineSha256 !== null)
      throw Error("Baseline must not reference mutable/self report");
  } else if (!hex(plan.referenceBaselineSha256))
    throw Error("Fixed baseline SHA required");
  return plan;
}
export function loadCapturePlan({ env, budgets, source, harnessFingerprint }) {
  for (const k of ["PERF_PILOT", "PERF_LINKS", "PERF_JOURNEYS", "PERF_RUNS"])
    if (env[k] !== undefined) throw Error("Unplanned selector forbidden: " + k);
  if (
    env.PERF_SHEET_PROTOCOL !== "ready-then-pinch-v2" ||
    env.PERF_JOURNEY_PROTOCOL !== PROTOCOL_ID ||
    env.PERF_DIAGNOSTICS !== "0"
  )
    throw Error(
      "Explicit original v2/disabled diagnostics/new15 protocol required",
    );
  const bytes = fs.readFileSync(env.PERF_CAPTURE_PLAN),
    digest = sha256(bytes);
  if (digest !== env.PERF_CAPTURE_PLAN_SHA256)
    throw Error("Capture plan bytes changed");
  const plan = JSON.parse(bytes);
  let expectedFailedCells;
  const entry = (file, expected) => {
    const raw = fs.readFileSync(file, "utf8");
    if (sha256(raw) !== expected)
      throw Error("Fixed prior report bytes changed");
    return JSON.parse(raw);
  };
  if (plan.role !== "baseline") {
    const b = entry(env.PERF_FIXED_BASELINE, plan.referenceBaselineSha256);
    const validFull = (r) => {
      const errors = validateReport(r);
      if (
        errors.length ||
        r.status !== "complete" ||
        r.protocol?.id !== PROTOCOL_ID ||
        r.harnessFingerprint !== harnessFingerprint ||
        r.measurement?.attemptIndex !== 0 ||
        !same(r.measurement?.requestedCells, fullCells(budgets))
      )
        throw Error("Malformed/wrong-method prior full report");
    };
    validFull(b);
    if (
      b.measurement?.role !== "baseline" ||
      b.measurement?.attemptIndex !== 0 ||
      b.samples.length !== 360
    )
      throw Error("Fixed complete baseline required");
    if (
      plan.role === "control" &&
      (b.sourceBuild !== source.sourceBuild ||
        b.sourceFingerprint !== source.sourceFingerprint ||
        b.build !== source.build)
    )
      throw Error("Unchanged control source differs");
    if (Date.parse(b.health.database.observedAt) >= Date.parse(plan.sealedAt))
      throw Error("Plan must follow completed baseline");
    if (plan.attemptIndex === 1) {
      const parent = entry(
        env.PERF_PARENT_FULL_REPORT,
        plan.parentFullReportSha256,
      );
      validFull(parent);
      if (
        !["control", "candidate"].includes(parent.measurement?.role) ||
        !same(parent.measurement?.fixturePrelude, plan.fixturePrelude) ||
        parent.measurement?.referenceBaselineSha256 !==
          plan.referenceBaselineSha256
      )
        throw Error("Parent role/prelude/reference differs");
      if (
        parent.measurement?.attemptIndex !== 0 ||
        parent.samples.length !== 360 ||
        parent.sourceBuild !== source.sourceBuild ||
        parent.sourceFingerprint !== source.sourceFingerprint ||
        parent.harnessFingerprint !== harnessFingerprint
      )
        throw Error("Confirmation parent binding differs");
      if (
        Date.parse(parent.health.database.observedAt) >=
        Date.parse(plan.sealedAt)
      )
        throw Error("Confirmation must be sealed after parent completed");
      const failures = failingCells(b, parent);
      expectedFailedCells = fullCells(budgets).filter((c) =>
        failures.some((f) => f.journey === c.journey && f.link === c.link),
      );
    }
  }
  validateCapturePlan(plan, {
    budgets,
    source,
    harnessFingerprint,
    expectedFailedCells,
  });
  return {
    plan,
    digest,
    measurement: {
      protocolId: plan.protocolId,
      durationDefinition: plan.durationDefinition,
      captureId: plan.captureId,
      role: plan.role,
      attemptIndex: plan.attemptIndex,
      sealedAt: plan.sealedAt,
      referenceBaselineSha256: plan.referenceBaselineSha256,
      parentFullReportSha256: plan.parentFullReportSha256 ?? null,
      requestedCells: plan.requestedCells,
      planSha256: digest,
      fixturePrelude: plan.fixturePrelude,
    },
  };
}
