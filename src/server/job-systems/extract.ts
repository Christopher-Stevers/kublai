import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { documentBlobPath } from "../documents/storage";
import { extractedSourceSchema, type AssessmentSource } from "./types";
/** Local, bounded extraction; only selected passages leave the server for assessment. */
export async function extractSpecification(
  organizationId: string,
  source: AssessmentSource,
) {
  const directory = await mkdtemp(path.join(tmpdir(), "foreman-spec-"));
  try {
    const target = path.join(directory, "text.json");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--max-old-space-size=768",
          "--import",
          "tsx",
          path.join(process.cwd(), "src/server/job-systems/extract-worker.ts"),
          documentBlobPath(organizationId, source.sha256),
          target,
          source.mimeType,
          source.fileName ?? source.name,
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
      }, 180000);
      child.once("error", () => {
        clearTimeout(timer);
        reject(Error("Specification text extraction is unavailable."));
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else
          reject(
            Error(
              `Could not read ${source.name}. Upload a searchable PDF or text document.`,
            ),
          );
      });
    });
    const data = await readFile(target, "utf8");
    if (data.length > 4 * 1024 * 1024)
      throw Error("Specification text exceeds the assessment limit.");
    return extractedSourceSchema.parse(JSON.parse(data));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
