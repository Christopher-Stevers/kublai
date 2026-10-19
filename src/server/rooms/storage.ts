import { openStreamingFile } from "../utils/open-streaming-file";
import { randomUUID } from "node:crypto";
import { readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { MAX_DRAWING_UPLOAD_BYTES } from "../../lib/drawing-upload-limits";

export const JOB_ROOM_FILE_PUBLIC_PREFIX = "/api/job-rooms/files";
export const MAX_JOB_FLOOR_PLAN_UPLOAD_BYTES = MAX_DRAWING_UPLOAD_BYTES;

const UPLOAD_ROOT = path.join(process.cwd(), "uploads", "job-floor-plans");

function safeJobId(jobId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
    throw new Error("Invalid job id");
  }
  return jobId;
}

export function getJobFloorPlanPdfKey(jobId: string) {
  return `${safeJobId(jobId)}/plan.pdf`;
}

export function getPdfKeyForFloorImage(imageStorageKey: string, jobId: string) {
  const parts = imageStorageKey.split("/");
  if (parts.length >= 3) {
    return `${parts[0]}/${parts[1]}/plan.pdf`;
  }
  return getJobFloorPlanPdfKey(jobId);
}

export function getSourcePageFromFloorImage(imageStorageKey: string) {
  const match = /floor-(\d+)\.webp$/i.exec(imageStorageKey);
  return match ? Number(match[1]) : null;
}

export async function readJobRoomFile(storageKey: string) {
  return readFile(path.join(UPLOAD_ROOT, storageKey));
}

/** Open once, then stream only requested bytes. Closing/cancellation owns the fd. */
export function openJobRoomFile(storageKey: string) {
  return openStreamingFile(path.join(UPLOAD_ROOT, storageKey));
}

export const JOB_ROOM_THUMBNAIL_WIDTH = 640;
const thumbnailJobs = new Map<string, Promise<void>>();

/** Small copy of a drawing page for cards and lists, made once and kept on disk. */
export async function openJobRoomThumbnail(storageKey: string) {
  if (!/(^|\/)floor-\d+\.webp$/i.test(storageKey))
    throw new Error("Not a drawing page");
  const source = path.join(UPLOAD_ROOT, storageKey);
  const thumbnailKey = storageKey.replace(
    /\.webp$/i,
    `.thumb-${JOB_ROOM_THUMBNAIL_WIDTH}.webp`,
  );
  const target = path.join(UPLOAD_ROOT, thumbnailKey);
  const [original, existing] = await Promise.all([
    stat(source),
    stat(target).catch(() => null),
  ]);
  // Legacy job-level pages can be replaced; rebuild when the page is newer.
  if (!existing || existing.mtimeMs < original.mtimeMs) {
    let job = thumbnailJobs.get(target);
    if (!job) {
      job = (async () => {
        const { default: sharp } = await import("sharp");
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
          // Read the bytes first: sharp caches by filename, and legacy pages
          // can be replaced in place.
          await sharp(await readFile(source))
            .resize({
              width: JOB_ROOM_THUMBNAIL_WIDTH,
              withoutEnlargement: true,
            })
            .webp({ quality: 75 })
            .toFile(temporary);
          await rename(temporary, target);
        } finally {
          await rm(temporary, { force: true });
        }
      })().finally(() => thumbnailJobs.delete(target));
      thumbnailJobs.set(target, job);
    }
    await job;
  }
  return openJobRoomFile(thumbnailKey);
}
