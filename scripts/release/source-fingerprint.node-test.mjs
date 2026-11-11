import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fingerprintSource, sourceEvidence } from "./source-fingerprint.mjs";
test("public source binding ignores private evidence but catches changed app code", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "source-binding-"));
  try {
    const source = path.join(root, "source"),
      copy = path.join(root, "copy");
    for (const dir of [source, copy]) {
      await mkdir(path.join(dir, "src"), { recursive: true });
      await writeFile(path.join(dir, "src/app.ts"), "export const value=1;");
    }
    const first = await fingerprintSource(source);
    await mkdir(path.join(source, "state-backups"), { recursive: true });
    await writeFile(
      path.join(source, "state-backups/private.json"),
      "private excluded",
    );
    await writeFile(path.join(source, ".env"), "SECRET=excluded");
    assert.equal(
      (await fingerprintSource(source)).sourceFingerprint,
      first.sourceFingerprint,
    );
    const evidence = await sourceEvidence(
      source,
      copy,
      "a".repeat(64),
      "before-lab-transforms",
    );
    assert.equal(evidence.sourceBinding.method, "frozen-release-inputs-sha256");
    assert.equal(evidence.sourceVerification.unchangedFilesChecked, 1);
    await writeFile(path.join(copy, "src/app.ts"), "export const value=2;");
    await assert.rejects(
      () => sourceEvidence(source, copy, "a".repeat(64)),
      /differs outside/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
