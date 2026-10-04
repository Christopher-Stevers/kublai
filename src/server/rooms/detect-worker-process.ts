import { spawn } from "node:child_process";
import path from "node:path";

import {
  failDetectJob,
  setDetectWorkerPid,
  type DetectMethod,
} from "~/server/rooms/detect-job";
import { claimNextDetectJob } from "./detect-queue";

export async function startDetectWorker(
  floorId: string,
  method: DetectMethod,
  runId: string,
) {
  const child = spawn(
    path.join(process.cwd(), "scripts/run-detect-worker.sh"),
    [floorId, method, runId],
    {
      cwd: process.cwd(),
      env: { ...process.env, FOREMANHQ_NODE_BINARY: process.execPath },
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  if (!child.pid) throw new Error("Room detection worker did not start");
  child.once("exit", (code, signal) => {
    const detail = signal
      ? `signal ${signal}`
      : `exit code ${code ?? "unknown"}`;
    // The guarded update is a no-op if the worker already recorded done/error.
    // Even a clean early exit must release the slot if no outcome was saved.
    void failDetectJob(
      floorId,
      `Room detection worker stopped (${detail})`,
      runId,
    )
      .then(() => dispatchDetectQueue())
      .catch((error) => console.error("[detect-worker-exit]", error));
  });
  try {
    await setDetectWorkerPid(floorId, child.pid, runId);
  } catch (error) {
    // We own this newly spawned process group; do not leave an untracked worker.
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* Already exited. */
    }
    throw error;
  }
  child.unref();
}

let dispatching: Promise<void> | null = null;

/** Called at application startup, periodically, and after each worker exits. */
export function dispatchDetectQueue(): Promise<void> {
  if (dispatching) return dispatching;
  dispatching = dispatch().finally(() => {
    dispatching = null;
  });
  return dispatching;
}

async function dispatch() {
  // A spawn failure belongs to that sheet; proceed with the rest of its batch.
  for (;;) {
    const next = await claimNextDetectJob();
    if (!next) return;
    try {
      await startDetectWorker(next.floorId, "complete", next.runId);
      return;
    } catch (error) {
      await failDetectJob(
        next.floorId,
        error instanceof Error
          ? error.message
          : "Could not start room detection",
        next.runId,
      );
    }
  }
}
