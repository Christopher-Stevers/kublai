// Operational orchestration guard, outside the immutable timing harness.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
export const CONFIG_KEYS = [
  "PERF_SHEET_PROTOCOL",
  "PERF_HARNESS_DIR",
  "PERF_SOURCE_ROOT",
  "PERF_SOURCE_BUILD_DIST",
  "PERF_BASELINE_DIST",
  "PERF_COMPARISON_BASELINE",
  "PERF_REUSE_SNAPSHOT",
  "PERF_SYNTHETIC_CACHE_ROOT",
  "PERF_IDLE_DURATION_MS",
  "PERF_JOURNEY_ADAPTER",
  "PERF_BASE_URL",
  "PERF_BUILD",
  "PERF_STATIC_REPORT",
  "PERF_RUN_EVIDENCE_DIR",
  "PERF_PILOT",
  "PERF_LINKS",
  "PERF_JOURNEYS",
  "PERF_RUNS",
];
export function validateProtocolConfig(env, baseline) {
  const expected = baseline?.protocol?.id;
  if (expected !== "ready-then-pinch-v2")
    throw Error("Predeclared baseline must use ready-then-pinch-v2");
  if (!env.PERF_SHEET_PROTOCOL)
    throw Error("PERF_SHEET_PROTOCOL must be explicitly exported");
  if (env.PERF_SHEET_PROTOCOL !== expected)
    throw Error("Exported sheet protocol differs from predeclared baseline");
  return {
    protocol: expected,
    effectiveEnvironment: Object.fromEntries(
      CONFIG_KEYS.filter((key) => env[key] !== undefined).map((key) => [
        key,
        env[key],
      ]),
    ),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const baseline = JSON.parse(
    fs.readFileSync(process.env.PERF_COMPARISON_BASELINE, "utf8"),
  );
  const result = validateProtocolConfig(process.env, baseline);
  process.stdout.write(JSON.stringify(result) + "\n");
}
