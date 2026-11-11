// Stable deploy-chain entry point.
import "../perf/check.mjs";
import fs from "node:fs";
import { compareReports } from "../perf/check.mjs";
try {
  const read = (name) => {
    const i = process.argv.indexOf(name);
    if (i < 0 || !process.argv[i + 1]) throw new Error(`Missing ${name}`);
    return JSON.parse(fs.readFileSync(process.argv[i + 1]));
  };
  const report = read("--report");
  const expectedIndex = process.argv.indexOf("--expected-build");
  if (expectedIndex >= 0 && report.build !== process.argv[expectedIndex + 1])
    throw new Error("Lab report does not match candidate build ID");
  const sourceIndex = process.argv.indexOf("--expected-source-build");
  if (
    sourceIndex >= 0 &&
    (report.sourceBuild !== process.argv[sourceIndex + 1] ||
      !/^[a-f0-9]{64}$/.test(report.sourceFingerprint ?? "") ||
      report.sourceFingerprintAlgorithm !== "foremanhq-lab-source-v1")
  )
    throw new Error("Lab report is not bound to the expected source release");
  const errors = compareReports(read("--baseline"), report);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Speed regression budgets pass");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
