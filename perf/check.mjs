import fs from "node:fs";
import { pathToFileURL } from "node:url";
export const budgets = JSON.parse(
  fs.readFileSync(new URL("./budgets.json", import.meta.url)),
);
export function validateReport(report) {
  const errors = [];
  if (
    report?.version !== 1 ||
    report?.provenance !== "isolated-seeded-app" ||
    report?.cpuSlowdown !== 4
  )
    errors.push(
      "Expected isolated-seeded-app report, version 1, CPU slowdown 4",
    );
  for (const journey of budgets.journeys)
    for (const link of Object.keys(budgets.links)) {
      const rows =
        report?.samples?.filter(
          (r) => r.journey === journey && r.link === link,
        ) ?? [];
      if (
        rows.length !== 5 ||
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
export function compareReports(before, after) {
  const errors = [...validateReport(before), ...validateReport(after)];
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
      if (next > old * 1.1)
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
      !Number.isFinite(after.static?.[key])
    )
      errors.push(`Missing static metric ${key}`);
    else if (after.static[key] > before.static[key])
      errors.push(
        `${key}: increased ${before.static[key]} -> ${after.static[key]}`,
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
    const errors = compareReports(
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
