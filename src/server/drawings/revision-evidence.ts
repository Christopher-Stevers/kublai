import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { RevisionScaleEvidence } from "~/lib/drawing-revision-review";
import type { PipeLinework } from "~/lib/pipe-system";
const execute = promisify(execFile);
function location(imageUrl: string, jobId: string) {
  const match =
    /^\/api\/job-rooms\/files\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/floor-([1-9]\d*)\.webp$/i.exec(
      imageUrl,
    );
  return match?.[1] === jobId
    ? {
        dest: path.join(
          process.cwd(),
          "uploads/job-floor-plans",
          match[1],
          match[2]!,
        ),
        page: Number(match[3]),
      }
    : null;
}
export async function prepareRevisionEvidence(
  sheets: Array<{ imageUrl: string }>,
  jobId: string,
) {
  const groups = new Map<string, Set<number>>();
  for (const sheet of sheets) {
    const loc = location(sheet.imageUrl, jobId);
    if (!loc) continue;
    try {
      await readFile(path.join(loc.dest, `revision-scale-${loc.page}-v1.json`));
    } catch {
      const pages = groups.get(loc.dest) ?? new Set<number>();
      pages.add(loc.page);
      groups.set(loc.dest, pages);
    }
  }
  // One bounded, isolated PDF parser at a time; failures mean verification is needed.
  for (const [dest, pages] of groups) {
    try {
      await execute(
        process.execPath,
        [
          "--max-old-space-size=512",
          "--import",
          "tsx",
          path.join(
            process.cwd(),
            "src/server/drawings/revision-evidence-worker.ts",
          ),
          dest,
          JSON.stringify([...pages]),
        ],
        { timeout: 60_000, maxBuffer: 65536 },
      );
    } catch {
      /* conservatively leave unverified */
    }
  }
}
export async function revisionEvidence(imageUrl: string, jobId: string) {
  const loc = location(imageUrl, jobId);
  if (!loc) return { scale: null, linework: null };
  try {
    const scale = JSON.parse(
      await readFile(
        path.join(loc.dest, `revision-scale-${loc.page}-v1.json`),
        "utf8",
      ),
    ) as RevisionScaleEvidence;
    const zipped = await readFile(
      path.join(loc.dest, `pipes-${loc.page}-v1.json`),
    );
    const data = JSON.parse(
      gunzipSync(zipped, { maxOutputLength: 64 * 1024 * 1024 }).toString(
        "utf8",
      ),
    ) as { linework: PipeLinework };
    return { scale, linework: data.linework };
  } catch {
    return { scale: null, linework: null };
  }
}
