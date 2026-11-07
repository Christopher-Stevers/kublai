import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Starting and checking the Drawings tile worker. Tiles are made after an
 * upload is split, and again whenever a folder is opened with pages still
 * missing tiles (e.g. after a server restart), so they always catch up.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function tileUploadDir(jobId: string, uploadId: string) {
  if (!UUID.test(jobId) || !UUID.test(uploadId)) throw new Error("Invalid upload");
  return path.join(process.cwd(), "uploads", "job-floor-plans", jobId, uploadId);
}
export function tileLockPath(jobId: string, uploadId: string) {
  return path.join(tileUploadDir(jobId, uploadId), "tiles", "worker.lock");
}

/** True while a tile worker for this upload is running. */
export async function tileWorkerAlive(jobId: string, uploadId: string) {
  const pid = Number(await readFile(tileLockPath(jobId, uploadId), "utf8").catch(() => ""));
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Uploads (job, upload) that have pages without tiles, from sheet image URLs. */
export function uploadsFromImageUrls(imageUrls: string[]) {
  const pages = new Map<string, { jobId: string; uploadId: string; pages: number[] }>();
  for (const url of imageUrls) {
    const match =
      /^\/api\/job-rooms\/files\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/floor-(\d+)\.webp$/i.exec(url);
    if (!match) continue;
    const key = `${match[1]}/${match[2]}`;
    const entry = pages.get(key) ?? { jobId: match[1]!, uploadId: match[2]!, pages: [] };
    entry.pages.push(Number(match[3]));
    pages.set(key, entry);
  }
  return [...pages.values()];
}

/** Starts the tile worker for an upload unless its tiles are done or it is running. */
export async function ensureDrawingTiles(jobId: string, uploadId: string, pages: number[]) {
  const dest = tileUploadDir(jobId, uploadId);
  const missing = await Promise.all(
    pages.map((page) =>
      access(path.join(dest, "tiles", String(page), "manifest.json"))
        .then(() => false)
        .catch(() => true),
    ),
  );
  if (!missing.some(Boolean) || (await tileWorkerAlive(jobId, uploadId))) return false;
  const child = spawn(
    path.join(process.cwd(), "scripts/run-tile-worker.sh"),
    [jobId, uploadId],
    {
      cwd: process.cwd(),
      env: { ...process.env, FOREMANHQ_NODE_BINARY: process.execPath },
      detached: true,
      stdio: "ignore",
    },
  );
  child.once("error", (error) => console.error("[drawing-tiles] start failed", uploadId, error));
  child.unref();
  return true;
}
