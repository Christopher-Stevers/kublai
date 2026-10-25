import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { documentBlobPath } from "../documents/storage";
import { extractedSourceSchema, type AssessmentSource } from "./types";

/** Bounded document owner. Nothing is started until an uncached batch is needed. */
export function extractionSession(
  organizationId: string,
  source: AssessmentSource,
) {
  let child: ChildProcess | undefined, directory: string | undefined;
  let starts = 0, peakRss = 0;
  let batches = 0,
    recycle = false;
  const stop = async () => {
    const current = child;
    child = undefined;
    if (
      current?.pid &&
      current.exitCode === null &&
      current.signalCode === null
    ) {
      const exited = new Promise<void>((resolve) =>
        current.once("exit", () => resolve()),
      );
      try {
        process.kill(-current.pid, "SIGKILL");
      } catch {
        /* already exited */
      }
      await exited;
    }
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  };
  const response = (current: ChildProcess, send?: () => void) =>
    new Promise<{ rss?: number }>((resolve, reject) => {
      const finish = (error?: Error, value: { rss?: number } = {}) => {
        clearTimeout(timer);
        current.off("message", message);
        current.off("error", failed);
        current.off("exit", failed);
        if (error) reject(error);
        else resolve(value);
      };
      const failed = () =>
        finish(Error("Specification text extraction is unavailable."));
      const message = (data: unknown) => {
        if (!data || typeof data !== "object") return;
        if (
          ("ready" in data && data.ready === true) ||
          ("ok" in data && data.ok === true)
        )
          finish(undefined, data as { rss?: number });
        else failed();
      };
      const timer = setTimeout(
        () =>
          finish(Error(`Could not read ${source.name}. Extraction timed out.`)),
        180_000,
      );
      current.on("message", message);
      current.once("error", failed);
      current.once("exit", failed);
      try {
        send?.();
      } catch {
        failed();
      }
    });
  return {
    close: stop,
    stats: () => ({starts, peakRss}),
    async read(start: number) {
      try {
        if (recycle) await stop();
        if (!child) {
          directory = await mkdtemp(path.join(tmpdir(), "foreman-spec-"));
          starts++;
          child = spawn(
            process.execPath,
            [
              "--max-old-space-size=768",
              "--import",
              "tsx",
              path.join(
                process.cwd(),
                "src/server/job-systems/extract-worker.ts",
              ),
              documentBlobPath(organizationId, source.sha256),
              path.join(directory, "text.json"),
              source.mimeType,
              source.fileName ?? source.name,
              "session",
            ],
            {
              stdio: ["ignore", "ignore", "ignore", "ipc"],
              detached: true,
              env: { ...process.env, OMP_THREAD_LIMIT: "1" },
            },
          );
          await response(child);
          batches = 0;
          recycle = false;
        }
        const active = child;
        const result = await response(active, () =>
          active.send({ start, count: 8 }),
        );
        peakRss = Math.max(peakRss, result.rss ?? 0);
        recycle = ++batches >= 8 || (result.rss ?? 0) > 768 * 1024 * 1024;
        const target = path.join(directory!, "text.json");
        if ((await stat(target)).size > 4 * 1024 * 1024)
          throw Error("Specification text exceeds the assessment limit.");
        return extractedSourceSchema.parse(
          JSON.parse(await readFile(target, "utf8")),
        );
      } catch (error) {
        await stop();
        throw error;
      }
    },
  };
}
