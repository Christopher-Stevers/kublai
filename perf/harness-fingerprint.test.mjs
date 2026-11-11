import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  HARNESS_FILES,
  fingerprintHarness,
  verifyFrozenHarness,
} from "./harness-fingerprint.mjs";
test("frozen method detects writable code and changed bytes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "perf-method-test-"));
  try {
    for (const name of HARNESS_FILES) {
      const file = path.join(root, name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, name);
      await fs.chmod(file, 0o444);
    }
    const expected = await fingerprintHarness(root);
    await fs.writeFile(
      path.join(root, "harness-manifest.json"),
      JSON.stringify(expected),
    );
    assert.equal(
      (await verifyFrozenHarness(root)).harnessFingerprint,
      expected.harnessFingerprint,
    );
    const target = path.join(root, "perf/journeys.mjs");
    await fs.chmod(target, 0o644);
    await assert.rejects(verifyFrozenHarness(root), /read-only/);
    await fs.writeFile(target, "changed");
    await fs.chmod(target, 0o444);
    await assert.rejects(verifyFrozenHarness(root), /changed/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
