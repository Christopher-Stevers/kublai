// Supplemental read-only analysis. Deliberately absent from HARNESS_FILES:
// adding this tool must not change a capture's frozen timing method.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { budgets, checkRepeatability, timingFails, validateReport } from "./check.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const protocolId = (report) =>
  typeof report.protocol === "string" ? report.protocol : report.protocol?.id;
function decode(bytes, label) {
  let report;
  try {
    report = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label}: invalid JSON`);
  }
  if (!report || typeof report !== "object" || Array.isArray(report))
    throw new Error(`${label}: JSON report must be an object`);
  return report;
}
function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const nearest = (q) => sorted[Math.ceil(sorted.length * q) - 1];
  return {
    count: sorted.length,
    minMs: sorted[0],
    medianMs: nearest(0.5),
    p95Ms: nearest(0.95),
    maxMs: sorted.at(-1),
  };
}
function inputErrors(report, label) {
  const errors = validateReport(report).map((error) => `${label}: ${error}`);
  if (report.status !== "complete")
    errors.push(`${label}: capture is not complete`);
  if (!report.timestamp || !Number.isFinite(Date.parse(report.timestamp)))
    errors.push(`${label}: explicit capture start time required`);
  if (!protocolId(report))
    errors.push(`${label}: explicit journey protocol required`);
  if (!report.harnessToolchain || !Object.keys(report.harnessToolchain).length)
    errors.push(`${label}: explicit harness toolchain required`);
  // Same finite/nonnegative static contract used by compareReports, not targets.
  for (const name of [
    "sharedGzipBytes",
    "screenGzipBytes",
    "deployGzipBytes",
    "idlePolls",
  ])
    if (!Number.isFinite(report.static?.[name]) || report.static[name] < 0)
      errors.push(`${label}: missing static metric ${name}`);
  for (const sample of report.samples ?? []) {
    if (
      sample.browserMeasures !== undefined &&
      !Array.isArray(sample.browserMeasures)
    ) {
      errors.push(`${label}: browserMeasures must be an array`);
      continue;
    }
    for (const stage of sample.browserMeasures ?? [])
      if (
        !stage ||
        typeof stage.name !== "string" ||
        !stage.name ||
        !Number.isFinite(stage.durationMs) ||
        stage.durationMs < 0
      )
        errors.push(
          `${label}: invalid browser stage at ${sample.journey}/${sample.link}/${sample.run}`,
        );
  }
  return errors;
}
function reportMetadata(report, bytes, label) {
  const preflight = report.health.preflight;
  const database = report.health.database;
  const fixture = report.health.fixtureSchema;
  return {
    label,
    sha256: sha256(bytes),
    bytes: bytes.length,
    build: report.build,
    sourceBuild: report.sourceBuild,
    sourceFingerprint: report.sourceFingerprint,
    sourceFileCount: report.sourceFileCount ?? null,
    sourceBinding: report.sourceBinding
      ? {
          method: report.sourceBinding.method,
          algorithm: report.sourceBinding.algorithm,
          sourceBuild: report.sourceBinding.sourceBuild,
        }
      : null,
    harnessFingerprint: report.harnessFingerprint,
    harnessFingerprintAlgorithm: report.harnessFingerprintAlgorithm,
    harnessFileCount: report.harnessFileCount,
    harnessToolchain: report.harnessToolchain,
    protocol: report.protocol,
    captureStartedAt: report.timestamp,
    // This is the exact recorded DB observation time, not an invented capture end.
    databaseWindowStartedAt: database.windowStartedAt,
    databaseObservedAt: database.observedAt,
    captureCompletedAt: report.completedAt ?? null,
    sampleCount: report.samples.length,
    health: {
      preflightStatus: preflight.status,
      preflightEndpoints: preflight.results.length,
      preflightOk: preflight.results.filter((row) => row.status === "ok")
        .length,
      databaseErrors: database.count,
      databaseFatals: database.fatalCount,
      fixtureTables: fixture.tableCount,
      fixtureModules: fixture.moduleCount,
    },
    static: {
      build: report.static.build ?? null,
      sharedGzipBytes: report.static.sharedGzipBytes,
      screenGzipBytes: report.static.screenGzipBytes,
      deployGzipBytes: report.static.deployGzipBytes,
      idlePolls: report.static.idlePolls,
    },
  };
}
function cellRows(report, journey, link) {
  return report.samples
    .filter((row) => row.journey === journey && row.link === link)
    .sort((a, b) => a.run - b.run);
}
function stages(first, second) {
  const names = [
    ...new Set(
      [...first, ...second].flatMap((row) =>
        (row.browserMeasures ?? []).map((stage) => stage.name),
      ),
    ),
  ].sort();
  const summarize = (rows, name) => {
    const byRun = rows.map((row) => ({
      run: row.run,
      durationMs: (row.browserMeasures ?? [])
        .filter((stage) => stage.name === name)
        .map((stage) => stage.durationMs),
    }));
    const values = byRun.flatMap((row) => row.durationMs);
    return {
      distribution: distribution(values),
      byRun,
      missingRuns: byRun
        .filter((row) => !row.durationMs.length)
        .map((row) => row.run),
    };
  };
  return names.map((name) => ({
    name,
    first: summarize(first, name),
    second: summarize(second, name),
  }));
}

/** Input hashes always describe supplied raw bytes, never reconstructed reports. */
export function summarizePair(firstBytes, secondBytes) {
  const first = decode(firstBytes, "first"),
    second = decode(secondBytes, "second");
  const errors = [
    ...inputErrors(first, "first"),
    ...inputErrors(second, "second"),
  ];
  for (const name of [
    "build",
    "sourceBuild",
    "sourceFingerprint",
    "harnessFingerprint",
  ])
    if (first[name] !== second[name]) errors.push(`Pair differs: ${name}`);
  if (
    JSON.stringify(first.harnessToolchain) !==
    JSON.stringify(second.harnessToolchain)
  )
    errors.push("Pair differs: harnessToolchain");
  if (protocolId(first) !== protocolId(second))
    errors.push("Pair differs: protocol");
  if (
    first.timestamp === second.timestamp ||
    sha256(firstBytes) === sha256(secondBytes)
  )
    errors.push("Pair requires distinct independent captures");
  if (errors.length) throw new Error([...new Set(errors)].join("\n"));

  // Initial diagnostic screen only: no calibration, prospective plan or confirmation is evaluated.
  const repeatabilityErrors = checkRepeatability(first, second);
  const cells = budgets.journeys.flatMap((journey) =>
    Object.keys(budgets.links).map((link) => {
      const a = cellRows(first, journey, link),
        b = cellRows(second, journey, link);
      const firstDistribution = distribution(a.map((row) => row.durationMs));
      const secondDistribution = distribution(b.map((row) => row.durationMs));
      const old = firstDistribution.medianMs,
        next = secondDistribution.medianMs;
      const absoluteDeltaMs = next - old;
      return {
        journey,
        link,
        first: {
          ...firstDistribution,
          byRun: a.map((row) => ({ run: row.run, durationMs: row.durationMs })),
        },
        second: {
          ...secondDistribution,
          byRun: b.map((row) => ({ run: row.run, durationMs: row.durationMs })),
        },
        deltaMs: absoluteDeltaMs,
        deltaPercent:
          old === 0 ? (next === 0 ? 0 : null) : (absoluteDeltaMs / old) * 100,
        initialTimingFailure: timingFails(old, next),
        relativeVariationOverTenPercent:
          Math.abs(absoluteDeltaMs) > old * budgets.noiseRatio,
        browserStages: stages(a, b),
      };
    }),
  );
  return {
    version: 2,
    kind: "supplemental-pair-summary",
    diagnosticOnly: true,
    releaseEligible: false,
    method:
      "Every original sample retained. Per-cell automation wallclock median uses fifteen samples (sorted index 7). Initial directional timing flags require both >10% and >17ms slower. Descriptive nearest-rank stage p50/p95 use every recorded stage occurrence; missing stages are explicit, never zero-filled. No pooling of the two runs.",
    limitations: [
      "Fifteen samples do not establish a stable p95. Browser stages are paint-opportunity proxies, not physical same-frame proof.",
      "Database observedAt is not asserted to be exact capture completion; completion stays null if unrecorded.",
      "This is an initial diagnostic screen, not calibrated release approval: no 20-run calibration, prospective confirmation plan or sole failed-cell remeasurement is validated. Canonical artifact binding and all release gates remain separate.",
    ],
    reports: [
      reportMetadata(first, firstBytes, "first"),
      reportMetadata(second, secondBytes, "second"),
    ],
    repeatability: {
      passes: repeatabilityErrors.length === 0,
      errors: repeatabilityErrors,
      noiseRatio: budgets.noiseRatio,
      absoluteRegressionMs: 17,
      policyId: budgets.timingPolicy.id,
      initialScreenOnly: true,
    },
    cells,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4)
      throw new Error(
        "Usage: node perf/summarize-pair.mjs first.json second.json",
      );
    const summary = summarizePair(
      fs.readFileSync(process.argv[2]),
      fs.readFileSync(process.argv[3]),
    );
    summary.summaryToolSha256 = sha256(
      fs.readFileSync(fileURLToPath(import.meta.url)),
    );
    summary.analysisDependencyHashes = Object.fromEntries(
      ["check.mjs", "budgets.json", "harness-fingerprint.mjs"].map((name) => [
        name,
        sha256(fs.readFileSync(new URL(name, import.meta.url))),
      ]),
    );
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.repeatability.passes) process.exitCode = 1;
  } catch (error) {
    console.error(`Pair summary rejected: ${error.message}`);
    process.exitCode = 1;
  }
}
