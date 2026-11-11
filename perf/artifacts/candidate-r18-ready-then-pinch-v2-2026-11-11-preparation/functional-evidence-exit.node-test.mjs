// Actual EXIT trap smoke; no PostgreSQL/browser, temporary metadata fixtures only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const source = fs.readFileSync(
  new URL(
    "../artifacts/r18-private-lab-preparation-2026-11-11/foremanhq-r18-pref-v6-server.sh",
    import.meta.url,
  ),
  "utf8",
);
const functions = source.slice(
  source.indexOf("preserve_evidence() {"),
  source.indexOf("node --input-type=module <<'JS'"),
);
for (const mode of [
  "missing-copy",
  "source-after-failure",
  "success",
  "original-failure",
]) {
  test(`actual EXIT trap ${mode} preserves evidence and exit semantics`, () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "foremanhq-functional-exit."),
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
        "private fixture log\n",
      );
      fs.writeFileSync(path.join(root, "fixtures.json"), "{}\n");
      fs.writeFileSync(path.join(snapshot, "source-evidence.json"), "{}\n");
      const code =
        `server_pid=\nevidence_dir="$DESTINATION"\n` +
        functions.replaceAll(
          "/tmp/foremanhq-r18-pref-v6-evidence",
          destination,
        ) +
        `
node(){ printf '%s\\n' source-after >> "$SMOKE_LOG";return ${mode === "source-after-failure" ? 7 : 0}; }
exit ${mode === "original-failure" ? 9 : 0}
`;
      const result = spawnSync("bash", ["-c", code], {
        env: {
          PATH: process.env.PATH,
          DESTINATION: destination,
          PERF_LAB_SOCKET: socket,
          PERF_LAB_FIXTURES: path.join(root, "fixtures.json"),
          snapshot,
          SMOKE_LOG: path.join(root, "calls"),
        },
        encoding: "utf8",
      });
      const failed = mode === "missing-copy" || mode === "source-after-failure";
      assert.equal(
        result.status,
        failed ? 1 : mode === "original-failure" ? 9 : 0,
      );
      const cleanup = JSON.parse(
        fs.readFileSync(path.join(destination, "server-cleanup.json")),
      );
      assert.equal(cleanup.inputExitCode, mode === "original-failure" ? 9 : 0);
      assert.equal(cleanup.evidenceCopyFailed, failed ? 1 : 0);
      assert.equal(
        fs.readFileSync(
          path.join(destination, "private-pg-before-helper-shutdown.log"),
          "utf8",
        ),
        "private fixture log\n",
      );
      assert.equal(
        fs.existsSync(path.join(destination, "fixtures.json")),
        true,
      );
      assert.equal(
        fs.existsSync(path.join(destination, "source-evidence-before.json")),
        true,
      );
      assert.equal(
        fs.readFileSync(path.join(root, "calls"), "utf8").trim(),
        "source-after",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(socket, { recursive: true, force: true });
    }
  });
}
