import { workerCommand } from "~/server/background/command";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { TitleBlockWord } from "~/lib/drawing-title-block";
const execute = promisify(execFile);
export type EquipmentIndex = {
  pages: Array<{ page: number; words: TitleBlockWord[] }>;
  incomplete: boolean;
  ocrPages?: number[];
};
const cache = new Map<string, { value: EquipmentIndex; bytes: number }>();
let cachedBytes = 0;
const pending = new Map<string, Promise<EquipmentIndex>>();
let running = 0;
const waiting: Array<() => void> = [];
async function slot() {
  if (running >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  else running++;
  return () => {
    const next = waiting.shift();
    if (next) next();
    else running--;
  };
}
export async function equipmentIndex(
  file: string,
  format: "pdf" | "office",
): Promise<EquipmentIndex> {
  const key = `${file}.equipment-v1.json`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return withOcr(file, cached.value);
  }
  const existing = pending.get(key);
  if (existing) return withOcr(file, await existing);
  const promise = (async () => {
    const read = async () => {
      const bytes = (await stat(key)).size;
      if (bytes > 48 * 1024 * 1024) throw Error("Invalid text index size");
      const value = JSON.parse(await readFile(key, "utf8")) as EquipmentIndex;
      if (bytes <= 8 * 1024 * 1024) {
        cache.set(key, { value, bytes });
        cachedBytes += bytes;
        while (cache.size > 4 || cachedBytes > 12 * 1024 * 1024) {
          const first = cache.keys().next().value!;
          cachedBytes -= cache.get(first)!.bytes;
          cache.delete(first);
        }
      }
      return value;
    };
    try {
      return await read();
    } catch {
      /* Build immutable-source index in an isolated worker. */
    }
    const release = await slot();
    try {
      await execute(
        process.execPath,
        [
          "--max-old-space-size=512",
          ...workerCommand("src/server/drawings/equipment-index-worker.ts"),
          file,
          key,
          format,
        ],
        { timeout: 60_000, maxBuffer: 65536 },
      );
      return await read();
    } finally {
      release();
    }
  })();
  pending.set(key, promise);
  try {
    return await withOcr(file, await promise);
  } finally {
    pending.delete(key);
  }
}

// OCR is explicit, bounded to one page per operation, and retained beside the
// immutable source. It never replaces the original PDF or embedded text index.
async function recognized(file: string): Promise<EquipmentIndex["pages"]> {
  try {
    const name = `${file}.equipment-ocr-v1.json`;
    if ((await stat(name)).size > 48 * 1024 * 1024) return [];
    return JSON.parse(await readFile(name, "utf8")) as EquipmentIndex["pages"];
  } catch {
    return [];
  }
}
async function withOcr(
  file: string,
  index: EquipmentIndex,
): Promise<EquipmentIndex> {
  const pages = await recognized(file);
  if (!pages.length) return index;
  const merged = new Map(index.pages.map((p) => [p.page, p]));
  for (const page of pages) merged.set(page.page, page);
  return {
    ...index,
    pages: [...merged.values()].sort((a, b) => a.page - b.page),
    ocrPages: pages.map((p) => p.page),
  };
}
const recognizing = new Map<string, Promise<void>>();
export async function recognizeEquipmentPage(
  file: string,
  page: number,
): Promise<void> {
  if (!Number.isInteger(page) || page < 1 || page > 2000)
    throw Error("Invalid OCR page");
  // Serialize updates to a file's supplement and deduplicate concurrent callers.
  while (recognizing.has(file)) await recognizing.get(file);
  const operation = (async () => {
    const existing = await recognized(file);
    if (existing.some((p) => p.page === page)) return;
    const release = await slot();
    const output = `${file}.equipment-ocr-${process.pid}-${page}.tmp`;
    try {
      await new Promise<void>((resolve, reject) => {
        const child = execFile(
          process.execPath,
          [
            "--max-old-space-size=512",
            ...workerCommand("src/server/drawings/equipment-index-worker.ts"),
            file,
            output,
            "pdf",
            String(page),
          ],
          {
            timeout: 55_000,
            maxBuffer: 65536,
            detached: true,
            killSignal: "SIGKILL",
          },
          (error) => {
            // A timeout must terminate Tesseract as well as its Node parent.
            if (child.pid)
              try {
                process.kill(-child.pid, "SIGKILL");
              } catch {
                /* The process group already exited. */
              }
            if (error) reject(error);
            else resolve();
          },
        );
      });
      if ((await stat(output)).size > 8 * 1024 * 1024)
        throw Error("OCR page exceeds reading limit");
      const result = JSON.parse(
        await readFile(output, "utf8"),
      ) as EquipmentIndex;
      const json = JSON.stringify([...existing, ...result.pages]);
      if (json.length > 48 * 1024 * 1024)
        throw Error("OCR cache exceeds reading limit");
      await writeFile(output, json, { mode: 0o600 });
      await rename(output, `${file}.equipment-ocr-v1.json`);
    } finally {
      release();
      await unlink(output).catch(() => undefined);
    }
  })();
  recognizing.set(file, operation);
  try {
    await operation;
  } finally {
    recognizing.delete(file);
  }
}
export function drawingPdfLocation(imageUrl: string, jobId: string) {
  const match =
    /^\/api\/job-rooms\/files\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/floor-([1-9]\d*)\.webp$/i.exec(
      imageUrl,
    );
  return match?.[1] === jobId
    ? {
        file: path.join(
          process.cwd(),
          "uploads/job-floor-plans",
          match[1],
          match[2]!,
          "plan.pdf",
        ),
        page: Number(match[3]),
      }
    : null;
}
