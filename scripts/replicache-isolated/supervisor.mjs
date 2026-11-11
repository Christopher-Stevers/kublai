import { spawn as nativeSpawn } from "node:child_process";
export function requiredArgument(argv, name) {
  const at = argv.indexOf(name);
  if (at < 0 || !argv[at + 1] || argv[at + 1].startsWith("--"))
    throw Error(`Required ${name}`);
  return argv[at + 1];
}
export function validateBinding(
  manifest,
  actual,
  expectedBuild,
  expectedFingerprint,
) {
  if (
    ![expectedBuild, expectedFingerprint].every((v) => /^[a-f0-9]{64}$/.test(v))
  )
    throw Error("Explicit canonical identities required");
  if (
    manifest.builder !== "webpack" ||
    actual !== expectedBuild ||
    manifest.sourceHash !== expectedBuild ||
    manifest.sourceFingerprint !== expectedFingerprint
  )
    throw Error("Canonical release binding mismatch");
}
export function createSupervisor({
  spawn = nativeSpawn,
  kill = process.kill.bind(process),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  deadlineMs = 420_000,
} = {}) {
  const state = { timedOut: false, interrupted: false };
  const active = new Set();
  function abort(kind) {
    state[kind] = true;
    for (const stop of active) stop();
  }
  const deadline = setTimer(() => abort("timedOut"), deadlineMs);
  function check() {
    if (state.timedOut || state.interrupted)
      throw Error("Run interrupted or deadline exceeded");
  }
  async function run(command, args, options, timeoutMs, cleanup = false) {
    if (!cleanup) check();
    const child = spawn(command, args, { ...options, detached: true });
    const pid = child.pid; // Every timer owns this exact process group.
    let forceTimer,
      rejectWait,
      settled = false,
      childTimedOut = false;
    const terminate = () => {
      if (settled || forceTimer) return;
      try {
        if (pid) kill(-pid, "SIGTERM");
      } catch {}
      forceTimer = setTimer(() => {
        if (!settled && pid) {
          try {
            kill(-pid, "SIGKILL");
          } catch {}
          rejectWait?.(Error("Child exceeded forced shutdown deadline"));
        }
      }, 2000);
    };
    active.add(terminate);
    const timeout = setTimer(() => {
      childTimedOut = true;
      terminate();
    }, timeoutMs);
    try {
      const code = await new Promise((resolve, reject) => {
        rejectWait = reject;
        child.once("error", reject);
        child.once("exit", resolve);
      });
      if (childTimedOut) throw Error("Child deadline exceeded");
      if (code !== 0) throw Error(`Child exited ${code}`);
      if (!cleanup) check();
      return code;
    } finally {
      settled = true;
      clearTimer(timeout);
      if (forceTimer) clearTimer(forceTimer);
      active.delete(terminate);
    }
  }
  return {
    state,
    check,
    run,
    interrupt: () => abort("interrupted"),
    finish: () => clearTimer(deadline),
  };
}
export function successful({
  stage,
  exitCode,
  timedOut,
  interrupted,
  postgresStopped,
  logPreserved,
  temporaryDirectoryRemoved,
  pgErrors,
  pgFatals,
  errors = [],
}) {
  return (
    stage === "passed" &&
    exitCode === 0 &&
    !timedOut &&
    !interrupted &&
    postgresStopped &&
    logPreserved &&
    temporaryDirectoryRemoved &&
    pgErrors === 0 &&
    pgFatals === 0 &&
    errors.length === 0
  );
}
/** Stop first, preserve the actual final log, then remove only confirmed-stopped data. */
export async function cleanupOwnedDatabase({
  stop,
  pidExists,
  copyLog,
  readLog,
  remove,
  logRequired,
}) {
  const errors = [];
  let postgresStopped = false,
    logPreserved = false,
    temporaryDirectoryRemoved = false;
  try {
    await stop();
  } catch {
    errors.push("Owned PostgreSQL stop failed or exceeded deadline");
  }
  try {
    postgresStopped = !(await pidExists());
  } catch {
    errors.push("PostgreSQL shutdown confirmation failed");
  }
  let log;
  if (logRequired) {
    try {
      await copyLog();
      log = await readLog();
      logPreserved = true;
    } catch {
      errors.push("Required final PostgreSQL log preservation failed");
    }
  } else {
    log = "";
    logPreserved = true;
  }
  if (postgresStopped && logPreserved) {
    try {
      await remove();
      temporaryDirectoryRemoved = true;
    } catch {
      errors.push("Temporary directory cleanup failed");
    }
  }
  return {
    postgresStopped,
    logPreserved,
    temporaryDirectoryRemoved,
    pgErrors: log === undefined ? null : (log.match(/ERROR:/g) ?? []).length,
    pgFatals: log === undefined ? null : (log.match(/FATAL:/g) ?? []).length,
    errors,
  };
}
