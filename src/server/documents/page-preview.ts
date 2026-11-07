import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { documentBlobPath } from "./storage";

// Two bounded processes, one shared request per immutable page. ACL checks belong
// to the caller, before consulting even this private, organization-scoped cache.
const pending = new Map<string, Promise<Buffer>>();
let active = 0;
const waiting: Array<() => void> = [];
async function slot() {
  if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  return () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
}
export async function documentPagePreview(
  organizationId: string,
  sha256: string,
  page: number,
) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 2000)
    throw new Error("Invalid preview page");
  const source = documentBlobPath(organizationId, sha256);
  const target = `${source}.preview-v1/${page}.webp`;
  try {
    return await readFile(target);
  } catch {
    /* Cache miss. */
  }
  const existing = pending.get(target);
  if (existing) return existing;
  // Bound queued work as well as native concurrency. Detail rendering remains
  // available if a burst of opens temporarily exhausts preview capacity.
  if (pending.size >= 16) throw new Error("Preview queue full");
  const work = (async () => {
    const release = await slot();
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      try {
        return await readFile(target);
      } catch {
        /* Another process may have finished. */
      }
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--max-old-space-size=512",
            "--import",
            "tsx",
            path.join(
              process.cwd(),
              "src/server/documents/page-preview-render.ts",
            ),
            source,
            temporary,
            String(page),
          ],
          { cwd: process.cwd(), env: process.env, stdio: "ignore" },
        );
        const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error("Preview rendering unavailable"));
        });
      });
      await rename(temporary, target);
      return await readFile(target);
    } finally {
      await unlink(temporary).catch(() => undefined);
      release();
    }
  })();
  pending.set(target, work);
  try {
    return await work;
  } finally {
    pending.delete(target);
  }
}
