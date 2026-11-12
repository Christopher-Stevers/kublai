// New evaluation protocol only. Never mutate reports or pool confirmation samples.
import { createHash } from "node:crypto";
import {
  LAB_TRANSFORM_PATHS,
  SOURCE_FINGERPRINT_ALGORITHM,
} from "../scripts/release/source-fingerprint.mjs";
import { budgets, validateReport, median, timingFails } from "./check.mjs";
export const POLICY_ID = "ready-then-pinch-v2-calibrated-15-v1";
export const PROTOCOL_ID = POLICY_ID;
export const FIXTURE_PRELUDE = {
  id: "private-seed-restore-reset-restart-v1",
  algorithm: "pg-custom-v1-sha256",
  seedSnapshotScope: "entire-private-db-before-app-start",
  drain: "owned-next-absent-and-zero-other-db-sessions",
  resetHelperSha256:
    "55435fd0de6480c37b9623be0860516fe083628bf55b2b213b97338e40a6271d",
  serverRestart: true,
  readPreflightCount: 14,
};
export const ALL_CELLS = Object.keys(budgets.links).flatMap((link) =>
  budgets.journeys.map((journey) => ({ journey, link })),
);
export const SEMANTIC_FIXTURE = {
  quoteItems: 25,
  quantity: 10,
  orderItems: 1,
  receivedQuantity: 0,
  verificationStatus: "pending",
  welcomeMessages: 1,
  generatedMessages: 0,
};
const key = (cell) => `${cell.journey}/${cell.link}`;
const sorted = (cells) => cells.map(key).sort();
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameCells = (a, b) =>
  Array.isArray(a) &&
  a.length === b.length &&
  equal(a.map(key), b.map(key)) &&
  new Set(sorted(a)).size === a.length;
const fail = (message) => {
  throw Error(message);
};
export function decodeEntry(entry) {
  if (
    typeof entry?.raw !== "string" ||
    !/^[a-f0-9]{64}$/.test(entry.sha256 ?? "") ||
    createHash("sha256").update(entry.raw).digest("hex") !== entry.sha256
  )
    fail("Raw evidence SHA256 mismatch");
  return JSON.parse(entry.raw);
}
export function failingCells(baseline, report) {
  return ALL_CELLS.filter(({ journey, link }) => {
    const values = (r) =>
      r.samples
        .filter((s) => s.journey === journey && s.link === link)
        .map((s) => s.durationMs);
    const b = values(baseline),
      c = values(report);
    return (
      c.length === 15 && b.length === 15 && timingFails(median(b), median(c))
    );
  });
}
function staticErrors(b, r) {
  return [
    "sharedGzipBytes",
    "screenGzipBytes",
    "deployGzipBytes",
    "idlePolls",
  ].flatMap((k) =>
    !Number.isFinite(b.static?.[k]) ||
    !Number.isFinite(r.static?.[k]) ||
    b.static[k] < 0 ||
    r.static[k] < 0
      ? [`Missing static metric ${k}`]
      : r.static[k] > b.static[k]
        ? [`${k}: increased ${b.static[k]} -> ${r.static[k]}`]
        : [],
  );
}
function inspect(
  capture,
  {
    baseline = null,
    baselineSha = null,
    parentSha = null,
    cells = ALL_CELLS,
    role,
    attempt = 0,
    seen,
  },
) {
  const report = decodeEntry(capture?.report),
    plan = decodeEntry(capture?.plan),
    m = report.measurement;
  if (report.status !== "complete")
    fail("Every capture must have complete status");
  if (
    (typeof report.protocol === "string"
      ? report.protocol
      : report.protocol?.id) !== POLICY_ID
  )
    fail("Actual report protocol differs from calibration policy");
  const errors = validateReport(report, cells);
  if (errors.length) fail(errors.join("\n"));
  if (
    report.samples.some(
      (s) => !cells.some((c) => c.journey === s.journey && c.link === s.link),
    )
  )
    fail("Unexpected sample cell");
  if (
    !m ||
    m.protocolId !== POLICY_ID ||
    m.durationDefinition !== "f9/v2-original-wallclock" ||
    m.role !== role ||
    m.attemptIndex !== attempt ||
    !sameCells(m.requestedCells, cells) ||
    m.referenceBaselineSha256 !== baselineSha ||
    (m.parentFullReportSha256 ?? null) !== parentSha ||
    m.planSha256 !== capture.plan.sha256
  )
    fail("Measurement provenance or exact requested cells mismatch");
  if (
    typeof m.captureId !== "string" ||
    !m.captureId ||
    seen.ids.has(m.captureId) ||
    seen.hashes.has(capture.report.sha256) ||
    seen.timestamps.has(report.timestamp)
  )
    fail("Duplicate or missing independent capture identity");
  seen.ids.add(m.captureId);
  seen.hashes.add(capture.report.sha256);
  seen.timestamps.add(report.timestamp);
  const sealed = Date.parse(plan.sealedAt),
    started = Date.parse(report.timestamp);
  if (
    !Number.isFinite(sealed) ||
    !Number.isFinite(started) ||
    !Number.isFinite(Date.parse(report.health.database.observedAt)) ||
    Date.parse(report.health.database.observedAt) < started ||
    sealed >= started
  )
    fail("Plan must be sealed before actual capture");
  for (const k of [
    "protocolId",
    "durationDefinition",
    "captureId",
    "role",
    "attemptIndex",
    "sealedAt",
    "referenceBaselineSha256",
    "parentFullReportSha256",
  ])
    if ((plan[k] ?? null) !== (m[k] ?? null))
      fail("Plan/report " + k + " mismatch");
  if (!sameCells(plan.requestedCells, cells))
    fail("Plan requested cells differ");
  if (
    !equal(plan.fixturePrelude, FIXTURE_PRELUDE) ||
    !equal(plan.fixturePrelude, m.fixturePrelude)
  )
    fail("Missing or unsupported fixture prelude");
  for (const k of [
    "sourceBuild",
    "sourceFingerprint",
    "build",
    "harnessFingerprint",
  ])
    if (plan[k] !== report[k]) fail("Plan/report " + k + " mismatch");
  if (baseline) {
    for (const k of [
      "harnessFingerprint",
      "harnessFingerprintAlgorithm",
      "harnessFileCount",
      "cpuSlowdown",
    ])
      if (report[k] !== baseline[k]) fail("Method binding differs: " + k);
    if (
      !equal(report.harnessToolchain, baseline.harnessToolchain) ||
      !equal(report.protocol, baseline.protocol)
    )
      fail("Protocol/toolchain differs");
  }
  if (
    report.sourceBinding?.method !== "frozen-release-inputs-sha256" ||
    report.sourceBinding?.algorithm !== SOURCE_FINGERPRINT_ALGORITHM ||
    report.sourceBinding.sourceBuild !== report.sourceBuild ||
    report.static?.build !== report.sourceBuild
  )
    fail("Source/static provenance differs");
  if (
    !Number.isSafeInteger(report.sourceFileCount) ||
    report.sourceFileCount < 1 ||
    report.sourceVerification?.stage !== "after-lab-transforms" ||
    !Number.isSafeInteger(report.sourceVerification?.unchangedFilesChecked) ||
    report.sourceVerification.unchangedFilesChecked <
      report.sourceFileCount - LAB_TRANSFORM_PATHS.length ||
    report.sourceVerification.unchangedFilesChecked > report.sourceFileCount ||
    !equal(report.sourceVerification.allowedLabTransforms, LAB_TRANSFORM_PATHS)
  )
    fail("Incomplete source verification");
  if (
    !Array.isArray(report.cellPreludes) ||
    report.cellPreludes.length !== cells.length ||
    !sameCells(report.cellPreludes, cells)
  )
    fail("Every requested cell requires one fixture certificate");
  for (const c of report.cellPreludes) {
    if (
      c.status !== "passed" ||
      c.stateVerified !== true ||
      c.restoreCompleted !== true ||
      c.drain?.priorServerAbsent !== true ||
      !Number.isSafeInteger(c.serverIdentity?.pid) ||
      c.serverIdentity.pid <= 0 ||
      !/^\d+$/.test(c.serverIdentity?.startTime ?? "") ||
      !Number.isFinite(Date.parse(c.observedAt)) ||
      Date.parse(c.observedAt) < started ||
      Date.parse(c.observedAt) >
        Date.parse(report.health.database.observedAt) ||
      c.algorithm !== FIXTURE_PRELUDE.algorithm ||
      !equal(c.semanticFixture, SEMANTIC_FIXTURE) ||
      c.resetCompleted !== true ||
      c.resetHelperSha256 !== FIXTURE_PRELUDE.resetHelperSha256 ||
      c.readPreflightCount !== 14 ||
      c.sourceBuild !== report.sourceBuild ||
      !equal(c.fixturePrelude, FIXTURE_PRELUDE) ||
      !["seedSnapshotSha256", "stateSha256", "preflightSha256"].every((k) =>
        /^[a-f0-9]{64}$/.test(c[k] ?? ""),
      ) ||
      !c.privateDatabase?.socket?.startsWith("/tmp/foremanhq-perf-pg.") ||
      c.privateDatabase.port !== 55463 ||
      c.privateDatabase.database !== "foremanhq_perf_lab" ||
      c.privateDatabase.otherSessions !== 0
    )
      fail("Invalid private fixture certificate");
  }
  if (
    new Set(report.cellPreludes.map((c) => c.privateDatabase.socket)).size !== 1
  )
    fail("Private socket changed within capture");
  if (
    new Set(report.cellPreludes.map((c) => c.seedSnapshotSha256)).size !== 1 ||
    new Set(report.cellPreludes.map((c) => c.stateSha256)).size !== 1
  )
    fail("Fixture state differs across cells within capture");
  return report;
}
const seenSet = () => ({
  ids: new Set(),
  hashes: new Set(),
  timestamps: new Set(),
});
function evaluateCapture(capture, baseline, baselineSha, role, seen) {
  const full = inspect(capture, { baseline, baselineSha, role, seen });
  if (
    Date.parse(full.timestamp) <=
    Date.parse(baseline.health.database.observedAt)
  )
    fail("Capture must follow completed fixed baseline");
  const failed = failingCells(baseline, full);
  const errors = staticErrors(baseline, full);
  if (
    role === "control" &&
    ["build", "sharedGzipBytes", "screenGzipBytes", "deployGzipBytes"].some(
      (k) => full.static[k] !== baseline.static[k],
    )
  )
    fail("Unchanged control canonical byte artifact differs");
  if (role === "control")
    for (const k of [
      "sourceBuild",
      "sourceFingerprint",
      "sourceFileCount",
      "build",
    ])
      if (full[k] !== baseline[k])
        fail("Unchanged control source/build differs: " + k);
  if (!failed.length) {
    if (capture.confirmation)
      fail("Unexpected confirmation for passing full run");
    return { full, initialFailedCells: [], confirmedFailedCells: [], errors };
  }
  if (!capture.confirmation)
    fail(
      "Exactly one predeclared confirmation required for all initially failed cells",
    );
  if (capture.confirmation.confirmation) fail("Second confirmation forbidden");
  const retry = inspect(capture.confirmation, {
    baseline,
    baselineSha,
    parentSha: capture.report.sha256,
    cells: failed,
    role: "remeasure",
    attempt: 1,
    seen,
  });
  if (
    Date.parse(retry.timestamp) <= Date.parse(full.health.database.observedAt)
  )
    fail("Confirmation must follow completed full capture");
  const plan = decodeEntry(capture.confirmation.plan);
  if (Date.parse(plan.sealedAt) <= Date.parse(full.health.database.observedAt))
    fail("Confirmation plan must follow completed initial evidence");
  for (const k of [
    "sourceBuild",
    "sourceFingerprint",
    "sourceFileCount",
    "build",
  ])
    if (retry[k] !== full[k]) fail("Confirmation source/build differs: " + k);
  if (
    [
      "build",
      "sharedGzipBytes",
      "screenGzipBytes",
      "deployGzipBytes",
      "idlePolls",
    ].some((k) => retry.static[k] !== full.static[k])
  )
    fail("Confirmation canonical bytes or retained initial idle count differ");
  // Initial full-run idle proof is authoritative; subset confirmation adds no idle capture.
  if (
    !equal(plan.fixturePrelude, decodeEntry(capture.plan).fixturePrelude) ||
    !plan.fixturePrelude
  )
    fail("Confirmation fixture prelude differs or missing");
  const confirmed = failingCells(baseline, retry);
  errors.push(
    ...confirmed.map(
      (c) =>
        `${key(c)}: failed both initial and sole confirmation (>10% AND >17ms)`,
    ),
  );
  return {
    full,
    initialFailedCells: failed,
    confirmedFailedCells: confirmed,
    errors,
  };
}
function calibrationResult(bundle, progress = false) {
  if (
    (progress
      ? !["incomplete", "complete"].includes(bundle?.status)
      : bundle?.status !== "complete") ||
    bundle?.policyId !== POLICY_ID ||
    !Array.isArray(bundle.controls) ||
    (progress ? bundle.controls.length > 19 : bundle.controls.length !== 19)
  )
    fail(
      "Calibration requires fixed baseline plus exactly19 independent controls",
    );
  const seen = seenSet();
  const baseline = inspect(bundle.baseline, { role: "baseline", seen });
  const baselineSha = bundle.baseline.report.sha256;
  let priorEnd = Date.parse(baseline.health.database.observedAt);
  const controls = bundle.controls.map((c) => {
    const r = evaluateCapture(c, baseline, baselineSha, "control", seen);
    if (Date.parse(r.full.timestamp) <= priorEnd)
      fail("Independent control captures overlap or are out of order");
    const last = c.confirmation ? decodeEntry(c.confirmation.report) : r.full;
    priorEnd = Date.parse(last.health.database.observedAt);
    return r;
  });
  const errors = controls.flatMap((r, i) =>
    r.errors.map((e) => `control${i + 1}: ${e}`),
  );
  return {
    policyId: POLICY_ID,
    baseline,
    baselineSha,
    controls,
    errors,
    seen,
    finalObservedAt: new Date(priorEnd).toISOString(),
  };
}
// Prospective orchestration screen: full validation, never release approval.
export function validateInitialCapture(capture, baselineCapture = null) {
  const seen = seenSet();
  if (!baselineCapture) {
    const report = inspect(capture, { role: "baseline", seen });
    return {
      report,
      initialFailedCells: [],
      errors: [],
      releaseEligible: false,
    };
  }
  const baseline = inspect(baselineCapture, { role: "baseline", seen }),
    role = decodeEntry(capture.report).measurement?.role;
  if (!["control", "candidate"].includes(role))
    fail("Initial capture must be control or candidate");
  const full = inspect(capture, {
    baseline,
    baselineSha: baselineCapture.report.sha256,
    role,
    seen,
  });
  if (
    Date.parse(full.timestamp) <=
    Date.parse(baseline.health.database.observedAt)
  )
    fail("Initial capture predates fixed baseline");
  if (role === "control")
    for (const k of [
      "sourceBuild",
      "sourceFingerprint",
      "sourceFileCount",
      "build",
    ])
      if (full[k] !== baseline[k]) fail("Unchanged control source differs");
  const errors = staticErrors(baseline, full);
  if (
    role === "control" &&
    ["build", "sharedGzipBytes", "screenGzipBytes", "deployGzipBytes"].some(
      (k) => full.static[k] !== baseline.static[k],
    )
  )
    fail("Unchanged control canonical bytes differ");
  return {
    report: full,
    initialFailedCells: failingCells(baseline, full),
    errors,
    releaseEligible: false,
  };
}
export function validateCalibration(bundle) {
  return calibrationResult(bundle);
}
export function evaluateCalibrationProgress(bundle) {
  const result = calibrationResult(bundle, true);
  return {
    policyId: POLICY_ID,
    status: "incomplete-diagnostic-only",
    completedControls: result.controls.length,
    errors: result.errors,
    releaseEligible: false,
  };
}
export function evaluateCalibratedRelease(bundle, candidate, activeReference) {
  const calibration = validateCalibration(bundle);
  if (calibration.errors.length) fail(calibration.errors.join("\n"));
  if (!activeReference?.baseline || !activeReference.repeat)
    fail("Independent active-source baseline/reference pair required");
  // Calibration is method-wide. Active references remain source-specific.
  const seen = seenSet();
  const baseline = inspect(activeReference.baseline, {
    role: "baseline",
    seen,
  });
  for (const k of [
    "harnessFingerprint",
    "harnessFingerprintAlgorithm",
    "harnessFileCount",
  ])
    if (baseline[k] !== calibration.baseline[k])
      fail("Active reference method differs from calibration");
  if (
    !equal(baseline.harnessToolchain, calibration.baseline.harnessToolchain) ||
    !equal(baseline.protocol, calibration.baseline.protocol)
  )
    fail("Active reference toolchain/protocol differs from calibration");
  const baselineSha = activeReference.baseline.report.sha256;
  const repeat = evaluateCapture(
    activeReference.repeat,
    baseline,
    baselineSha,
    "control",
    seen,
  );
  if (repeat.errors.length) fail(repeat.errors.join("\n"));
  const lastReference = activeReference.repeat.confirmation
    ? decodeEntry(activeReference.repeat.confirmation.report)
    : repeat.full;
  const result = evaluateCapture(
    candidate,
    baseline,
    baselineSha,
    "candidate",
    seen,
  );
  if (
    Date.parse(result.full.timestamp) <= Date.parse(calibration.finalObservedAt)
  )
    fail("Candidate must start after completed calibration");
  if (
    Date.parse(result.full.timestamp) <=
    Date.parse(lastReference.health.database.observedAt)
  )
    fail("Candidate must follow completed active reference pair");
  return {
    policyId: POLICY_ID,
    calibrationFullRuns: 20,
    calibrationFinalObservedAt: calibration.finalObservedAt,
    calibrationBaselineSha256: calibration.baselineSha,
    baselineSha256: baselineSha,
    initialFailedCells: result.initialFailedCells,
    confirmedFailedCells: result.confirmedFailedCells,
    errors: result.errors,
    passed: result.errors.length === 0,
  };
}
