// Makes map-style tiles for every page of one Drawings upload, a few pages at a
// time, each page in its own process. Never imported by the Next.js server.
// Usage: tile-worker.ts <jobId> <uploadId>
import { spawn } from "node:child_process";
import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tileLockPath, tileUploadDir, tileWorkerAlive } from "./tiles";

const CONCURRENCY = 3;
const PAGE_SECONDS = 180;

function renderPage(dest: string, page: number) {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=1024",
        "--import",
        "dotenv/config",
        "--import",
        "tsx",
        path.join(moduleDir, "tile-render-page.ts"),
        dest,
        String(page),
      ],
      { cwd: path.resolve(moduleDir, "../../.."), env: process.env, stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4096);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), PAGE_SECONDS * 1000);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`page ${page}: ${signal ?? `exit ${code}`} ${stderr.trim().split("\n").at(-1) ?? ""}`));
    });
  });
}

async function run(jobId: string, uploadId: string) {
  const dest = tileUploadDir(jobId, uploadId);
  const lock = tileLockPath(jobId, uploadId);
  await mkdir(path.dirname(lock), { recursive: true });
  // Only one worker per upload: create the lock atomically, replacing it only
  // when the process that wrote it is gone.
  try {
    await writeFile(lock, String(process.pid), { flag: "wx" });
  } catch {
    if (await tileWorkerAlive(jobId, uploadId)) return;
    await rm(lock, { force: true });
    await writeFile(lock, String(process.pid), { flag: "wx" });
  }
  try {
    const pages = (await readdir(dest))
      .map((name) => /^floor-(\d+)\.webp$/.exec(name)?.[1])
      .filter((page): page is string => Boolean(page))
      .map(Number)
      .sort((a, b) => a - b);
    const todo: number[] = [];
    for (const page of pages) {
      const done = await access(path.join(dest, "tiles", String(page), "manifest.json"))
        .then(() => true)
        .catch(() => false);
      if (!done) todo.push(page);
    }
    const failures: string[] = [];
    const next = async () => {
      for (let page = todo.shift(); page !== undefined; page = todo.shift()) {
        // A failed page keeps using the saved image; the rest still get tiles.
        await renderPage(dest, page).catch((error: unknown) =>
          failures.push(error instanceof Error ? error.message : String(error)),
        );
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, next));
    if (failures.length) console.error("[drawing-tiles]", uploadId, failures.join("; "));
  } finally {
    await rm(lock, { force: true });
  }
}

const [jobId, uploadId] = process.argv.slice(2);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!jobId || !uploadId || !UUID.test(jobId) || !UUID.test(uploadId)) {
  console.error("Usage: tile-worker.ts <jobId> <uploadId>");
  process.exit(64);
}
run(jobId, uploadId)
  .catch((error: unknown) => {
    console.error("[drawing-tiles]", uploadId, error);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
