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
export async function extractSlip(
  organizationId: string,
  sha256: string,
  mime: string,
) {
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
    return result.parse(JSON.parse(data));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
