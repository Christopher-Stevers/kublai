import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { BoundedCache } from "./bounded-cache";
import { JOB_ROOM_FILE_PUBLIC_PREFIX, getPdfKeyForFloorImage } from "./storage";

const fingerprints = new BoundedCache<string>(128, 128 * 512, 15 * 60_000, 2);
/** Capture actual review-time bytes, including for manually added spaces. */
export async function sourceDrawingHash(floor: {
  imageUrl: string;
  jobId: string;
}) {
  const prefix = `${JOB_ROOM_FILE_PUBLIC_PREFIX}/`;
  if (!floor.imageUrl.startsWith(prefix)) return null;
  const key = floor.imageUrl.slice(prefix.length);
  if (
    !/^[0-9a-f-]{36}\/(?:[0-9a-f-]{36}\/)?floor-\d+\.webp$/i.test(key) ||
    key.split("/")[0] !== floor.jobId
  )
    return null;
  const source = path.join(
    process.cwd(),
    "uploads",
    "job-floor-plans",
    getPdfKeyForFloorImage(key, floor.jobId),
  );
  try {
    const before = await stat(source);
    const cacheKey = `${source}:${before.size}:${before.mtimeMs}:${before.ctimeMs}`;
    return await fingerprints.get(
      cacheKey,
      async () => {
        const bytes = await readFile(source);
        const after = await stat(source);
        if (
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          before.ctimeMs !== after.ctimeMs
        )
          throw new Error(
            "Drawing changed while recording this review. Try again.",
          );
        return createHash("sha256").update(bytes).digest("hex");
      },
      () => 512,
    );
  } catch (error) {
    // A missing legacy source must not block manual work. It cannot become
    // verified training truth until the drawing is available and reviewed again.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
