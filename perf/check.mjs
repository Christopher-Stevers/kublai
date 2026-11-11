import fs from "node:fs";
import {
  HARNESS_FINGERPRINT_ALGORITHM,
  HARNESS_FILES,
} from "./harness-fingerprint.mjs";
import { pathToFileURL } from "node:url";
export const budgets = JSON.parse(
  fs.readFileSync(new URL("./budgets.json", import.meta.url)),
);
export const READ_PREFLIGHT_PROCEDURES = [
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
export function validateReport(report) {
  const errors = [];
  if (
    !/^[a-f0-9]{64}$/.test(report?.harnessFingerprint ?? "") ||
    report.harnessFingerprintAlgorithm !== HARNESS_FINGERPRINT_ALGORITHM ||
    report.harnessFileCount !== HARNESS_FILES.length ||
    report.harnessVerification?.before !== report.harnessFingerprint ||
    report.harnessVerification?.after !== report.harnessFingerprint ||
    report.harnessVerification?.immutable !== true
  )
    errors.push("Frozen harness method binding is missing or changed");
  if (
    !/^[a-f0-9]{64}$/.test(report?.sourceBuild ?? "") ||
    !/^[a-f0-9]{64}$/.test(report?.sourceFingerprint ?? "")
  )
    errors.push("Canonical source build and source fingerprint are required");
  const preflight = report?.health?.preflight;
  if (
    !preflight ||
    preflight.status !== "passed" ||
    preflight.build !== report.build ||
    preflight.sourceBuild !== report.sourceBuild ||
    preflight.sourceFingerprint !== report.sourceFingerprint ||
    READ_PREFLIGHT_PROCEDURES.some(
      (name) =>
        !preflight.results?.some(
          (row) => row.procedure === name && row.status === "ok",
        ),
    )
  )
    errors.push(
      "Source-bound read-endpoint preflight evidence is missing or failed",
    );
  const database = report?.health?.database;
  if (
    !database ||
    database.count !== 0 ||
    database.fatalCount !== 0 ||
    database.windowStartedAt !== report.timestamp ||
    !database.observedAt
  )
    errors.push(
      "Capture requires an observed private database window with zero ERROR/FATAL entries",
    );
  const fixture = report?.health?.fixtureSchema;
  if (
    !fixture ||
    fixture.status !== "source-declared-schemas-created" ||
    fixture.sourceBuild !== report.sourceBuild ||
    fixture.sourceFingerprint !== report.sourceFingerprint ||
    !Number.isInteger(fixture.tableCount) ||
    fixture.tableCount < 1 ||
    !Number.isInteger(fixture.moduleCount) ||
    fixture.moduleCount < 1
  )
    errors.push("Source-bound fixture schema inventory is missing");
  if (
    typeof report?.build !== "string" ||
    !report.build ||
    report.build === "unknown"
  )
    errors.push("Explicit measured build ID required");
  if (
    report?.version !== 1 ||
    report?.provenance !== "isolated-seeded-app" ||
    report?.cpuSlowdown !== 4
  )
    errors.push(
      "Expected isolated-seeded-app report, version 1, CPU slowdown 4",
    );
  if (
    report?.samples?.length !==
    budgets.journeys.length * Object.keys(budgets.links).length * budgets.runs
  )
    errors.push("Expected exact full lab matrix");
  for (const journey of budgets.journeys)
    for (const link of Object.keys(budgets.links)) {
      const rows =
        report?.samples?.filter(
          (r) => r.journey === journey && r.link === link,
        ) ?? [];
      if (
        rows.length !== 5 ||
        (["openjob", "switchjobtabs", "openmateriallist"].includes(journey) &&
          rows.some((row) => row.variant !== "visited")) ||
        new Set(rows.map((row) => row.run)).size !== 5 ||
        rows.some(
          (row) => !Number.isInteger(row.run) || row.run < 0 || row.run > 4,
        ) ||
        rows.some((r) => !Number.isFinite(r.durationMs) || r.durationMs < 0)
      )
        errors.push(
          `${journey}/${link}: five finite durationMs samples required`,
        );
    }
  return errors;
}
const median = (rows) => [...rows].sort((a, b) => a - b)[2];
const protocolId = (report) =>
  typeof report?.protocol === "string"
    ? report.protocol
    : (report?.protocol?.id ?? "legacy-unlabeled");
export function compareReports(before, after) {
  const errors = [...validateReport(before), ...validateReport(after)];
  if (
    before?.harnessFingerprint !== after?.harnessFingerprint ||
    JSON.stringify(before?.harnessToolchain) !==
      JSON.stringify(after?.harnessToolchain)
  )
    errors.push(
      "Timing harness or toolchain differs; timings cannot be compared",
    );
  if (protocolId(before) !== protocolId(after))
    errors.push("Journey protocol differs; timings cannot be compared");
  if (errors.length) return errors;
  for (const journey of budgets.journeys)
    for (const link of Object.keys(budgets.links)) {
      const value = (report) =>
        median(
          report.samples
            .filter((r) => r.journey === journey && r.link === link)
            .map((r) => r.durationMs),
        );
      const old = value(before),
        next = value(after);
      if (next > old * (1 + budgets.noiseRatio))
        errors.push(
          `${journey}/${link}: median ${next.toFixed(1)}ms exceeds ${old.toFixed(1)}ms baseline +10%`,
        );
    }
  for (const key of [
    "sharedGzipBytes",
    "screenGzipBytes",
    "deployGzipBytes",
    "idlePolls",
  ]) {
    if (
      !Number.isFinite(before.static?.[key]) ||
      !Number.isFinite(after.static?.[key]) ||
      before.static[key] < 0 ||
      after.static[key] < 0
    )
      errors.push(`Missing static metric ${key}`);
    else if (after.static[key] > before.static[key])
      errors.push(
        `${key}: increased ${before.static[key]} -> ${after.static[key]}`,
      );
  }
  return errors;
}
/** Phase 0 uses two independent full runs, separate from a deploy regression check. */
export function checkRepeatability(first, second) {
  const errors = [...validateReport(first), ...validateReport(second)];
  if (
    first?.harnessFingerprint !== second?.harnessFingerprint ||
    JSON.stringify(first?.harnessToolchain) !==
      JSON.stringify(second?.harnessToolchain)
  )
    errors.push(
      "Timing harness or toolchain differs; repeatability cannot be inferred",
    );
  if (protocolId(first) !== protocolId(second))
    errors.push("Journey protocol differs; repeatability cannot be inferred");
  if (errors.length) return errors;
  if (
    !first.timestamp ||
    !second.timestamp ||
    first.timestamp === second.timestamp
  )
    errors.push(
      "Repeatability requires distinct captured runs, not the same report twice",
    );
  if (!first.build || first.build === "unknown" || first.build !== second.build)
    errors.push("Repeatability requires matching explicit build IDs");
  for (const journey of budgets.journeys)
    for (const link of Object.keys(budgets.links)) {
      const value = (report) =>
        median(
          report.samples
            .filter((row) => row.journey === journey && row.link === link)
            .map((row) => row.durationMs),
        );
      const a = value(first),
        b = value(second);
      if (Math.abs(a - b) > a * budgets.noiseRatio)
        errors.push(
          `${journey}/${link}: independent-run medians differ by more than 10% (${a} vs ${b}ms)`,
        );
    }
  return errors;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
  try {
    if (
      !process.argv.includes("--baseline") ||
      !process.argv.includes("--report")
    )
      throw new Error(
        "Usage: node perf/check.mjs --baseline before.json --report after.json",
      );
    const errors = (
      process.argv.includes("--repeatability")
        ? checkRepeatability
        : compareReports
    )(
      JSON.parse(fs.readFileSync(arg("--baseline"))),
      JSON.parse(fs.readFileSync(arg("--report"))),
    );
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      "Speed regression budgets pass (lab evidence only; field/Phase 0 gate remains separate).",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
