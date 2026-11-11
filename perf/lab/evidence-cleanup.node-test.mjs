// No DB/browser: execute the actual prepared shell functions against temp files.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const source = fs.readFileSync(
  new URL(
    "../artifacts/candidate-r17-ready-then-pinch-v2-attempt2-2026-11-11-preparation/orchestration.sh",
    import.meta.url,
  ),
  "utf8",
);
const functions = source.slice(
  source.indexOf("preserve_evidence() {"),
  source.indexOf("trap final_cleanup EXIT"),
);
for (const mode of ["missing-copy", "source-after-failure", "success"]) {
  test(`cleanup/evidence ${mode} propagates status and retains remaining evidence`, () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "foremanhq-evidence-smoke."),
    );
    const socket = fs.mkdtempSync("/tmp/foremanhq-perf-pg.smoke.");
    try {
      const destination = path.join(root, "evidence"),
        snapshot = path.join(root, "snapshot");
      fs.mkdirSync(destination);
      fs.mkdirSync(snapshot);
      if (mode !== "missing-copy")
        fs.writeFileSync(path.join(socket, "schema-inventory.json"), "{}\n");
      fs.writeFileSync(
        path.join(socket, "server.log"),
        "private synthetic log\n",
      );
      fs.writeFileSync(path.join(root, "fixtures.json"), "{}\n");
      fs.writeFileSync(path.join(snapshot, "preflight.json"), "{}\n");
      // Only the exact output-directory allowlist is rebound to this temp fixture.
      const code =
        functions.replaceAll(
          "/tmp/foremanhq-r17-full-v2-attempt2-evidence",
          destination,
        ) +
        `
cleanup(){ printf '%s\\n' cleanup >> "$SMOKE_LOG"; }
node(){ printf '%s\\n' source-after >> "$SMOKE_LOG"; return ${mode === "source-after-failure" ? 7 : 0}; }
final_cleanup
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
      assert.equal(result.status, mode === "success" ? 0 : 1);
      assert.deepEqual(
        fs.readFileSync(path.join(root, "calls"), "utf8").trim().split("\n"),
        ["cleanup", "source-after"],
      );
      assert.equal(
        fs.readFileSync(
          path.join(destination, "private-pg-before-helper-shutdown.log"),
          "utf8",
        ),
        "private synthetic log\n",
      );
      assert.equal(
        fs.existsSync(path.join(destination, "fixtures.json")),
        true,
      );
      assert.equal(
        fs.existsSync(path.join(destination, "preflight.json")),
        true,
      );
      if (mode !== "success")
        assert.match(result.stderr, /THIS_RUN_EVIDENCE_COPY_FAILED/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(socket, { recursive: true, force: true });
    }
  });
}
