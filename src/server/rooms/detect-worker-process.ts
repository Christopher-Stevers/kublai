import { spawn } from "node:child_process";
import path from "node:path";

import { failDetectJob, setDetectWorkerPid } from "~/server/rooms/detect-job";

export async function startDetectWorker(floorId: string) {
  const workerScript = path.join(
    process.cwd(),
    "src/server/rooms/detect-worker.ts",
  );
  const packageManager = process.env.npm_execpath;
  const command = packageManager ? process.execPath : "pnpm";
  const args = packageManager
    ? [packageManager, "exec", "tsx", workerScript, floorId]
    : ["exec", "tsx", workerScript, floorId];
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
  });

  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  if (!child.pid) {
    throw new Error("Room detection worker did not start");
  }
  await setDetectWorkerPid(floorId, child.pid);
  child.once("exit", (code, signal) => {
    if (code === 0) return;
    const detail = signal
      ? `signal ${signal}`
      : `exit code ${code ?? "unknown"}`;
    void failDetectJob(floorId, `Room detection worker stopped (${detail})`);
  });
  child.unref();
}
