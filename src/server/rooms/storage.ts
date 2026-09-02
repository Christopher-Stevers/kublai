import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const JOB_ROOM_FILE_PUBLIC_PREFIX = "/api/job-rooms/files";
export const MAX_JOB_FLOOR_PLAN_UPLOAD_BYTES = 40 * 1024 * 1024;

const UPLOAD_ROOT = path.join(process.cwd(), "uploads", "job-floor-plans");

function safeJobId(jobId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
    throw new Error("Invalid job id");
  }
  return jobId;
}

function jobDir(jobId: string) {
  return path.join(UPLOAD_ROOT, safeJobId(jobId));
}

export function getJobFloorPlanPdfKey(jobId: string) {
  return `${safeJobId(jobId)}/plan.pdf`;
}

export function getJobFloorImageKey(jobId: string, pageNumber: number) {
  return `${safeJobId(jobId)}/floor-${pageNumber}.webp`;
}

export function getJobRoomFileUrl(storageKey: string) {
  return `${JOB_ROOM_FILE_PUBLIC_PREFIX}/${storageKey}`;
}

export function validateJobFloorPlanPdf(file: File) {
  const type = file.type.toLowerCase();
  if (type && type !== "application/pdf") {
    return "Uploaded file must be a PDF";
  }
  if (!file.name.toLowerCase().endsWith(".pdf") && type !== "application/pdf") {
    return "Uploaded file must be a PDF";
  }
  if (file.size > MAX_JOB_FLOOR_PLAN_UPLOAD_BYTES) {
    return "PDF must be smaller than 40MB";
  }
  return null;
}

export async function writeJobRoomFile(storageKey: string, buffer: Buffer) {
  const fullPath = path.join(UPLOAD_ROOT, storageKey);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);
}

export async function readJobRoomFile(storageKey: string) {
  return readFile(path.join(UPLOAD_ROOT, storageKey));
}

export async function replaceJobFloorPlanFiles(jobId: string) {
  await rm(jobDir(jobId), { recursive: true, force: true });
  await mkdir(jobDir(jobId), { recursive: true });
}

export function makeManualRoomId() {
  return randomUUID();
}
