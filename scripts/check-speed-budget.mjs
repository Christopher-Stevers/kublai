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
  const errors = compareReports(read("--baseline"), read("--report"));
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Speed regression budgets pass");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
