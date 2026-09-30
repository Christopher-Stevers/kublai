import { spawn } from "node:child_process";
import path from "node:path";

import {
  failDetectJob,
  setDetectWorkerPid,
  type DetectMethod,
} from "~/server/rooms/detect-job";

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
  if (!child.pid) {
    throw new Error("Room detection worker did not start");
  }
  await setDetectWorkerPid(floorId, child.pid, runId);
  child.once("exit", (code, signal) => {
    if (code === 0) return;
    const detail = signal
      ? `signal ${signal}`
      : `exit code ${code ?? "unknown"}`;
    void failDetectJob(
      floorId,
      `Room detection worker stopped (${detail})`,
      runId,
    ).catch((error) => console.error("[detect-worker-exit]", error));
  });
  child.unref();
}
