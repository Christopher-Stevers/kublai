import test from "node:test";
import assert from "node:assert/strict";
import { validateProtocolConfig } from "./check-protocol-config.mjs";
const baseline = { protocol: { id: "ready-then-pinch-v2" } };
test("missing protocol fails before any database or browser action", () => {
  assert.throws(
    () => validateProtocolConfig({}, baseline),
    /explicitly exported/,
  );
});
test("wrong protocol fails rather than silently using adapter default", () => {
  assert.throws(
    () =>
      validateProtocolConfig(
        { PERF_SHEET_PROTOCOL: "early-pinch-v1" },
        baseline,
      ),
    /differs/,
  );
});
test("correct exported protocol passes with only allowlisted effective environment", () => {
  const result = validateProtocolConfig(
    {
      PERF_SHEET_PROTOCOL: "ready-then-pinch-v2",
      PERF_IDLE_DURATION_MS: "600000",
      DATABASE_URL: "do-not-emit",
      CLERK_SECRET_KEY: "do-not-emit",
      PERF_UNKNOWN: "do-not-emit",
    },
    baseline,
  );
  assert.deepEqual(result, {
    protocol: "ready-then-pinch-v2",
    effectiveEnvironment: {
      PERF_SHEET_PROTOCOL: "ready-then-pinch-v2",
      PERF_IDLE_DURATION_MS: "600000",
    },
  });
});
test("invalid baseline cannot make a matching wrong protocol pass", () => {
  assert.throws(
    () =>
      validateProtocolConfig(
        { PERF_SHEET_PROTOCOL: "early-pinch-v1" },
        { protocol: { id: "early-pinch-v1" } },
      ),
    /baseline/,
  );
});

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const cli = fileURLToPath(
  new URL("./check-protocol-config.mjs", import.meta.url),
);
const baselinePath = fileURLToPath(
  new URL(
    "../artifacts/baseline-ready-then-pinch-v2-rerun-2026-11-11-1.json",
    import.meta.url,
  ),
);
for (const [label, value, expectedStatus] of [
  ["missing", undefined, 1],
  ["wrong", "early-pinch-v1", 1],
  ["correct", "ready-then-pinch-v2", 0],
]) {
  test(`actual CLI ${label} protocol is checked without starting DB/browser`, () => {
    const env = { PERF_COMPARISON_BASELINE: baselinePath };
    if (value !== undefined) env.PERF_SHEET_PROTOCOL = value;
    const result = spawnSync(process.execPath, [cli], {
      env,
      encoding: "utf8",
    });
    assert.equal(result.status, expectedStatus);
    if (expectedStatus === 0)
      assert.equal(JSON.parse(result.stdout).protocol, "ready-then-pinch-v2");
    else assert.equal(result.stdout, "");
  });
}
