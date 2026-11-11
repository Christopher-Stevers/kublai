import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  requiredArgument,
  validateBinding,
  createSupervisor,
  successful,
  cleanupOwnedDatabase,
} from "./supervisor.mjs";
const binding = {
  builder: "webpack",
  sourceHash: "a".repeat(64),
  sourceFingerprint: "b".repeat(64),
};
test("required input and canonical identity failures happen before any process work", () => {
  assert.throws(() => requiredArgument([], "--source"), /Required/);
  assert.throws(
    () => requiredArgument(["--source", "--build"], "--source"),
    /Required/,
  );
  assert.throws(
    () =>
      validateBinding(
        binding,
        "c".repeat(64),
        binding.sourceHash,
        binding.sourceFingerprint,
      ),
    /mismatch/,
  );
  assert.throws(
    () =>
      validateBinding(
        binding,
        binding.sourceHash,
        binding.sourceHash,
        "unknown",
      ),
    /Explicit/,
  );
});
function fixture() {
  let sequence = 0;
  const timers = new Map(),
    children = [],
    kills = [];
  const supervisor = createSupervisor({
    spawn() {
      const c = new EventEmitter();
      c.pid = 100 + children.length;
      children.push(c);
      return c;
    },
    kill(pid, signal) {
      kills.push([pid, signal]);
    },
    setTimer(fn, ms) {
      const id = ++sequence;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
  });
  const fire = (ms) => {
    const entry = [...timers.entries()].find(([, t]) => t.ms === ms);
    assert(entry);
    timers.delete(entry[0]);
    entry[1].fn();
  };
  return { supervisor, children, kills, timers, fire };
}
test("child timeout owns one PID and deferred SIGKILL is cleared at exit", async () => {
  const f = fixture();
  const first = f.supervisor.run("noop", [], {}, 10);
  f.fire(10);
  assert.deepEqual(f.kills, [[-100, "SIGTERM"]]);
  f.children[0].emit("exit", 0);
  await assert.rejects(first, /deadline/);
  assert.equal(
    [...f.timers.values()].some((t) => t.ms === 2000),
    false,
  );
  const second = f.supervisor.run("noop", [], {}, 10);
  f.children[1].emit("exit", 0);
  await second;
  assert.deepEqual(f.kills, [[-100, "SIGTERM"]]);
  f.supervisor.finish();
});
test("forced shutdown is bounded even if child never emits exit", async () => {
  const f = fixture();
  const run = f.supervisor.run("noop", [], {}, 10);
  f.fire(10);
  f.fire(2000);
  await assert.rejects(run, /forced shutdown/);
  assert.deepEqual(f.kills, [
    [-100, "SIGTERM"],
    [-100, "SIGKILL"],
  ]);
  f.supervisor.finish();
});
test("global deadline and interruption cannot become a pass after successful exit", async () => {
  for (const signal of ["timeout", "interrupt"]) {
    const f = fixture();
    const run = f.supervisor.run("noop", [], {}, 10);
    if (signal === "timeout") f.fire(420_000);
    else f.supervisor.interrupt();
    f.children[0].emit("exit", 0);
    await assert.rejects(run, /interrupted|deadline/);
    assert.throws(f.supervisor.check);
    f.supervisor.finish();
  }
});
const clean = {
  stage: "passed",
  exitCode: 0,
  timedOut: false,
  interrupted: false,
  postgresStopped: true,
  logPreserved: true,
  temporaryDirectoryRemoved: true,
  pgErrors: 0,
  pgFatals: 0,
  errors: [],
};
test("success requires explicit zero exit, no interruption/deadline, and complete cleanup/log evidence", () => {
  assert.equal(successful(clean), true);
  for (const delta of [
    { exitCode: 1 },
    { exitCode: undefined },
    { timedOut: true },
    { interrupted: true },
    { logPreserved: false },
    { postgresStopped: false },
    { pgErrors: null },
    { pgErrors: 1 },
    { pgFatals: 1 },
    { errors: ["stop failed"] },
  ])
    assert.equal(successful({ ...clean, ...delta }), false);
});
test("final log is copied/read only after stop and before data removal", async () => {
  const order = [];
  const c = await cleanupOwnedDatabase({
    stop: async () => order.push("stop"),
    pidExists: async () => false,
    copyLog: async () => order.push("copy"),
    readLog: async () => {
      order.push("read");
      return "";
    },
    remove: async () => order.push("remove"),
    logRequired: true,
  });
  assert.deepEqual(order, ["stop", "copy", "read", "remove"]);
  assert.equal(c.logPreserved, true);
});
test("required log copy/read failures preserve the directory and unknown error counts", async () => {
  for (const fail of ["copy", "read"]) {
    let removed = false;
    const c = await cleanupOwnedDatabase({
      stop: async () => {},
      pidExists: async () => false,
      copyLog: async () => {
        if (fail === "copy") throw Error("copy failed");
      },
      readLog: async () => {
        throw Error("read failed");
      },
      remove: async () => {
        removed = true;
      },
      logRequired: true,
    });
    assert.equal(removed, false);
    assert.equal(c.logPreserved, false);
    assert.equal(c.pgErrors, null);
    assert.equal(successful({ ...clean, ...c }), false);
  }
});
test("failed stop plus existing PID preserves DB, even with a preserved log", async () => {
  let removed = false;
  const c = await cleanupOwnedDatabase({
    stop: async () => {
      throw Error("timeout");
    },
    pidExists: async () => true,
    copyLog: async () => {},
    readLog: async () => "",
    remove: async () => {
      removed = true;
    },
    logRequired: true,
  });
  assert.equal(removed, false);
  assert.equal(c.postgresStopped, false);
  assert.equal(successful({ ...clean, ...c }), false);
});
test("cleanup child has an independent outer bound after the main deadline", async () => {
  const f = fixture();
  f.fire(420_000);
  const cleanup = f.supervisor.run("pg_ctl", [], {}, 15_000, true);
  f.fire(15_000);
  f.fire(2000);
  await assert.rejects(cleanup, /forced shutdown/);
  assert.deepEqual(f.kills, [
    [-100, "SIGTERM"],
    [-100, "SIGKILL"],
  ]);
  f.supervisor.finish();
});
test("runner CLI rejects missing arguments and a mismatched canonical build without starting a DB", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "replicache-negative-"));
  const script = new URL("../check-replicache-isolated.mjs", import.meta.url)
    .pathname;
  try {
    const env = {
      PATH: process.env.PATH,
      DATABASE_URL: "postgresql://must-not-be-used.invalid/no_database",
    };
    const missing = spawnSync(process.execPath, [script], {
      env,
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Required --source/);
    await writeFile(join(dir, "BUILD_ID"), "c".repeat(64));
    await writeFile(join(dir, "release-assets.json"), JSON.stringify(binding));
    const mismatch = spawnSync(
      process.execPath,
      [
        script,
        "--source",
        dir,
        "--build",
        dir,
        "--expected-build",
        binding.sourceHash,
        "--expected-fingerprint",
        binding.sourceFingerprint,
      ],
      { env, encoding: "utf8", timeout: 5000 },
    );
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /Canonical release binding mismatch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
