import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const source = fs.readFileSync(
  new URL(
    "../artifacts/candidate-r18-ready-then-pinch-v2-2026-11-11-preparation/orchestration.sh",
    import.meta.url,
  ),
  "utf8",
);
const functions = source.slice(
  source.indexOf("preserve_evidence() {"),
  source.indexOf("trap final_cleanup EXIT"),
);
for (const mode of [
  "missing-copy",
  "source-after-failure",
  "shutdown-failure",
  "success",
  "original-failure",
]) {
  test(`full-wrapper actual EXIT ${mode} records all outcomes`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "foremanhq-full-exit.")),
      socket = fs.mkdtempSync("/tmp/foremanhq-perf-pg.smoke.");
    try {
      const destination = path.join(root, "evidence"),
        snapshot = path.join(root, "snapshot");
      fs.mkdirSync(destination);
      fs.mkdirSync(snapshot);
      if (mode !== "missing-copy")
        fs.writeFileSync(path.join(socket, "schema-inventory.json"), "{}\n");
      fs.writeFileSync(path.join(socket, "server.log"), "fixture log\n");
      fs.writeFileSync(path.join(root, "fixtures.json"), "{}\n");
      fs.writeFileSync(path.join(snapshot, "preflight.json"), "{}\n");
      const code =
        functions.replaceAll(
          "/tmp/foremanhq-r18-full-v2-evidence",
          destination,
        ) +
        `
cleanup(){ printf '%s\\n' cleanup >> "$SMOKE_LOG";return ${mode === "shutdown-failure" ? 5 : 0}; }
node(){ printf '%s\\n' source-after >> "$SMOKE_LOG";return ${mode === "source-after-failure" ? 7 : 0}; }
trap final_cleanup EXIT
exit ${mode === "original-failure" ? 9 : 0}
`;
      const result = spawnSync("bash", ["-c", code], {
        env: {
          PATH: process.env.PATH,
          PERF_RUN_EVIDENCE_DIR: destination,
          PERF_LAB_SOCKET: socket,
          PERF_LAB_FIXTURES: path.join(root, "fixtures.json"),
          snapshot,
          SMOKE_LOG: path.join(root, "calls"),
        },
        encoding: "utf8",
      });
      const copyFailed =
          mode === "missing-copy" || mode === "source-after-failure",
        failed = copyFailed || mode === "shutdown-failure";
      assert.equal(
        result.status,
        failed ? 1 : mode === "original-failure" ? 9 : 0,
      );
      const metadata = JSON.parse(
        fs.readFileSync(path.join(destination, "final-cleanup.json")),
      );
      assert.equal(metadata.inputExitCode, mode === "original-failure" ? 9 : 0);
      assert.equal(metadata.evidenceCopyFailed, copyFailed ? 1 : 0);
      assert.equal(
        metadata.shutdownFailed,
        mode === "shutdown-failure" ? 1 : 0,
      );
      assert.deepEqual(
        fs.readFileSync(path.join(root, "calls"), "utf8").trim().split("\n"),
        ["cleanup", "source-after"],
      );
      assert.equal(
        fs.existsSync(
          path.join(destination, "private-pg-before-helper-shutdown.log"),
        ),
        true,
      );
      assert.equal(
        fs.existsSync(path.join(destination, "preflight.json")),
        true,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(socket, { recursive: true, force: true });
    }
  });
}
