import { checkpoint } from "./checkpoint";
import type { ExtractedSource } from "./types";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { documentBlobPath } from "../documents/storage";
import { extractedSourceSchema, type AssessmentSource } from "./types";
/** Local, bounded extraction; only selected passages leave the server for assessment. */
async function extractChunk(
  organizationId: string,
  source: AssessmentSource,
  startPage: number,
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
          String(startPage),
          "8",
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

export async function extractSpecification(
  organizationId: string,
  source: AssessmentSource,
  options?: {
    checkpointRoot: string;
    progress: (stage: string) => Promise<void>;
  },
): Promise<ExtractedSource> {
  const result: ExtractedSource = { pages: [], warnings: [] };
  let nextPage = 1;
  do {
    await options?.progress(
      `Reading ${source.name}: pages ${nextPage}–${result.totalPages ? Math.min(nextPage + 7, result.totalPages) : nextPage + 7}${result.totalPages ? ` of ${result.totalPages}` : ""}`,
    );
    const start = nextPage;
    const work = () => extractChunk(organizationId, source, start);
    const chunk = options
      ? await checkpoint(
          options.checkpointRoot,
          { version: 1, type: "extraction", source, start },
          (v) => extractedSourceSchema.parse(v),
          work,
        )
      : await work();
    result.pages.push(...chunk.pages);
    result.warnings.push(...chunk.warnings);
    result.totalPages = chunk.totalPages;
    nextPage += 8;
  } while (
    source.mimeType === "application/pdf" &&
    result.totalPages &&
    nextPage <= result.totalPages
  );
  return result;
}
