import { openStreamingFile } from "../utils/open-streaming-file";
import { readFile } from "node:fs/promises";
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
