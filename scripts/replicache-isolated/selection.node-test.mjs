// Prepared during quiet; do not execute until root releases runtime.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectCheckMode,
  assertSupplementalBinding,
  supplementalBinding,
} from "./selection.mjs";
const expected = {
  sourceBuild: "a".repeat(64),
  sourceFingerprint: "b".repeat(64),
  testSha256: "c".repeat(64),
};
test("default mode keeps the original selected program and exact report path", () => {
  const selected = selectCheckMode([]);
  assert.equal(selected.mode, "existing");
  assert.equal(selected.program, "./scripts/check-replicache-sync.ts");
  assert.equal(selected.source, null);
  assert.equal(
    selected.output,
    ".tmp/performance-implementation/sync-integration.json",
  );
  assert.equal(selected.evidence, "sync-integration.json");
  assert.deepEqual(selectCheckMode(["--check", "existing"]), selected);
});
test("only the enumerated supplemental mode is accepted", () => {
  const selected = selectCheckMode(["--check", "push-contract-v1"]);
  assert.equal(selected.source, "perf/replicache-push-contract.ts");
  assert.equal(selected.output, ".tmp/push-contract-v1.json");
  for (const args of [
    ["--check", "/tmp/arbitrary.ts"],
    ["--check", "unknown"],
    ["--check"],
    ["--check", "existing", "--check", "push-contract-v1"],
  ])
    assert.throws(() => selectCheckMode(args));
});
test("missing/false verification marker cannot enable supplemental assertions", () => {
  assert.throws(() => supplementalBinding(expected, false));
  assert.throws(() => assertSupplementalBinding(undefined, expected));
  const marker = supplementalBinding(expected, true);
  assertSupplementalBinding(marker, expected);
  for (const delta of [
    { mode: "existing" },
    { actualApplicationClientVerified: false },
    { sourceBuild: "d".repeat(64) },
    { sourceFingerprint: "d".repeat(64) },
    { testSha256: "d".repeat(64) },
    { testSha256: undefined },
  ])
    assert.throws(() =>
      assertSupplementalBinding({ ...marker, ...delta }, expected),
    );
  assert.throws(() =>
    supplementalBinding({ ...expected, testSha256: "not-a-hash" }, true),
  );
});
test("unknown mode CLI rejects before source/evidence/database setup", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    process.execPath,
    [
      new URL("../check-replicache-isolated.mjs", import.meta.url).pathname,
      "--check",
      "unknown",
    ],
    {
      encoding: "utf8",
      timeout: 5000,
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: "postgres://must-not-be-used.invalid/unused",
      },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown isolated check mode/);
  assert.doesNotMatch(result.stderr, /Required --source/);
});
