import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { documentBlobPath } from "../documents/storage";
const word = z.object({
  text: z.string().max(4000),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite(),
  confidence: z.number().min(0).max(100),
});
const result = z.object({
  rows: z
    .array(
      z.object({
        page: z.number().int().min(1).max(20),
        text: z.string().max(700),
        words: z.array(word).max(1000),
      }),
    )
    .max(500),
  warnings: z.array(z.string()).max(30),
});
type Extracted = Awaited<ReturnType<typeof readSlip>>;
/** Recent readings by file, so matching a slip to its order and then reading
 * it in full runs the OCR once. */
const recent = new Map<string, { at: number; value: Extracted }>();
const KEEP_MS = 15 * 60_000;
export async function extractSlip(
  organizationId: string,
  sha256: string,
  mime: string,
): Promise<Extracted> {
  const key = `${organizationId}:${sha256}:${mime}`;
  for (const [k, v] of recent) if (Date.now() - v.at > KEEP_MS) recent.delete(k);
  let kept = recent.get(key)?.value;
  if (!kept) {
    kept = await readSlip(organizationId, sha256, mime);
    // Small: a few phone photos, not long PDFs.
    if (kept.pages.reduce((n, p) => n + p.length, 0) < 16 * 1024 * 1024) {
      recent.set(key, { at: Date.now(), value: kept });
      while (recent.size > 4) recent.delete(recent.keys().next().value!);
    }
  }
  // Copies: the analysis must not change what a later caller reads.
  return {
    ...(structuredClone({ rows: kept.rows, warnings: kept.warnings }) as Omit<
      Extracted,
      "pages"
    >),
    pages: kept.pages.map((p) => Buffer.from(p)),
  };
}
async function readSlip(organizationId: string, sha256: string, mime: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "foreman-slip-"));
  try {
    const target = path.join(directory, "text.json");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--max-old-space-size=512",
          "--import",
          "tsx",
          path.join(
            process.cwd(),
            "src/server/packing-slips/extract-worker.ts",
          ),
          documentBlobPath(organizationId, sha256),
          target,
          mime,
        ],
        {
          stdio: "ignore",
          detached: true,
          env: { ...process.env, OMP_THREAD_LIMIT: "1" },
        },
      );
      const timer = setTimeout(() => {
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            /* exited */
          }
        }
      }, 300000);
      child.once("error", () => {
        clearTimeout(timer);
        reject(
          Error("Packing-slip text reading is unavailable. Please retry."),
        );
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else
          reject(
            Error("Could not read this packing slip. Try a clearer scan."),
          );
      });
    });
    const data = await readFile(target, "utf8");
    if (data.length > 4 * 1024 * 1024)
      throw Error("Packing slip contains too much text.");
    const parsed = result.parse(JSON.parse(data));
    // Page images, in order; a missing page stops the list (no image check past it).
    const pages: Buffer[] = [];
    for (let n = 1; n <= 20; n++) {
      const png = await readFile(path.join(directory, `page-${n}.png`)).catch(
        () => null,
      );
      if (!png) break;
      pages.push(png);
    }
    return { ...parsed, pages };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
