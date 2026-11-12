import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
export const HARNESS_FINGERPRINT_ALGORITHM = "foremanhq-frozen-harness-v1";
export const HARNESS_FILES = [
  "package.json",
  "tsconfig.json",
  "perf/harness-fingerprint.mjs",
  "perf/freeze-harness.mjs",
  "perf/run.mjs",
  "perf/capture-plan.mjs",
  "perf/calibrated-policy.mjs",
  "perf/calibration-orchestrator.mjs",
  "perf/calibration-stage.sh",
  "perf/lab/calibration-cell-prelude.sh",
  "perf/lab/calibration-state.mjs",
  "perf/lab/calibration-storage.mjs",
  "perf/lab/calibration-finalize.mjs",
  "perf/lab/owned-process-supervisor.py",
  "perf/journeys.mjs",
  "perf/budgets.json",
  "perf/check.mjs",
  "perf/preflight.mjs",
  "perf/idle.mjs",
  "perf/summarize.mjs",
  "perf/create-lab-snapshot.mjs",
  "perf/refresh-lab.mjs",
  "perf/full-baseline.sh",
  "perf/pilot.sh",
  "perf/auth/clerk-client.jsx",
  "perf/auth/clerk-server.mjs",
  "perf/lab/seed.ts",
  "perf/lab/reset-writes.mjs",
  "perf/lab/schema-entry.mjs",
  "perf/lab/drizzle.config.ts",
  "perf/lab/order-schema.mjs",
  "perf/lab/make-set.mts",
  "perf/lab/database.sh",
  "perf/lab/pg-error-report.mjs",
  "scripts/release/source-fingerprint.mjs",
  "scripts/release/static-metrics.mjs",
  "scripts/release/script-map.mjs",
  "scripts/release/static-assets.mjs",
].sort();
export async function fingerprintHarness(root) {
  const hash = createHash("sha256");
  hash.update(HARNESS_FINGERPRINT_ALGORITHM + "\0");
  const files = [];
  for (const name of HARNESS_FILES) {
    const bytes = await readFile(path.join(root, name));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    hash.update(name + "\0");
    hash.update(bytes);
    files.push({ path: name, sha256 });
  }
  return {
    harnessFingerprint: hash.digest("hex"),
    harnessFingerprintAlgorithm: HARNESS_FINGERPRINT_ALGORITHM,
    harnessFileCount: files.length,
    files,
  };
}
export async function verifyFrozenHarness(root) {
  const manifest = JSON.parse(
    await readFile(path.join(root, "harness-manifest.json"), "utf8"),
  );
  const actual = await fingerprintHarness(root);
  if (
    actual.harnessFingerprint !== manifest.harnessFingerprint ||
    actual.harnessFileCount !== manifest.harnessFileCount
  )
    throw new Error("Frozen timing harness changed");
  for (const file of actual.files)
    if ((await stat(path.join(root, file.path))).mode & 0o222)
      throw new Error("Timing harness files must remain read-only");
  return actual;
}
