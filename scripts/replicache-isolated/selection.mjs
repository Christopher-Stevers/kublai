import { requiredArgument } from "./supervisor.mjs";
const checks = Object.freeze({
  existing: Object.freeze({
    mode: "existing",
    program: "./scripts/check-replicache-sync.ts",
    source: null,
    output: ".tmp/performance-implementation/sync-integration.json",
    evidence: "sync-integration.json",
    log: "sync-check",
    stage: "existing-check",
  }),
  "push-contract-v1": Object.freeze({
    mode: "push-contract-v1",
    program: "./perf/replicache-push-contract.ts",
    source: "perf/replicache-push-contract.ts",
    output: ".tmp/push-contract-v1.json",
    evidence: "push-contract-v1.json",
    log: "push-contract-check",
    stage: "push-contract-check",
  }),
});
export function selectCheckMode(argv) {
  if (argv.filter((x) => x === "--check").length > 1)
    throw Error("Only one check mode is allowed");
  const name = argv.includes("--check")
    ? requiredArgument(argv, "--check")
    : "existing";
  if (!Object.hasOwn(checks, name)) throw Error("Unknown isolated check mode");
  return checks[name];
}
export function assertSupplementalBinding(binding, expected) {
  if (
    binding?.mode !== "push-contract-v1" ||
    binding.actualApplicationClientVerified !== true ||
    binding.sourceBuild !== expected.sourceBuild ||
    binding.sourceFingerprint !== expected.sourceFingerprint ||
    binding.testSha256 !== expected.testSha256 ||
    ![
      expected.sourceBuild,
      expected.sourceFingerprint,
      expected.testSha256,
    ].every((x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x))
  )
    throw Error("Supplemental check binding mismatch");
}
export function supplementalBinding(expected, actualApplicationClientVerified) {
  const binding = {
    mode: "push-contract-v1",
    ...expected,
    actualApplicationClientVerified,
  };
  assertSupplementalBinding(binding, expected);
  return binding;
}
