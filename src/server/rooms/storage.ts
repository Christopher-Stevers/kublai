import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_DRAWING_UPLOAD_BYTES, MAX_DRAWING_UPLOAD_MB } from "../../lib/drawing-upload-limits";

export const JOB_ROOM_FILE_PUBLIC_PREFIX = "/api/job-rooms/files";
export const MAX_JOB_FLOOR_PLAN_UPLOAD_BYTES = MAX_DRAWING_UPLOAD_BYTES;

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

export function getJobUploadPdfKey(jobId: string, uploadId: string) {
  return `${safeJobId(jobId)}/${uploadId}/plan.pdf`;
}

export function getJobFloorImageKey(
  jobId: string,
  pageNumber: number,
  uploadId?: string,
) {
  if (uploadId) {
    return `${safeJobId(jobId)}/${uploadId}/floor-${pageNumber}.webp`;
  }
  return `${safeJobId(jobId)}/floor-${pageNumber}.webp`;
}

export function getPdfKeyForFloorImage(imageStorageKey: string, jobId: string) {
  const parts = imageStorageKey.split("/");
  if (parts.length >= 3) {
    return `${parts[0]}/${parts[1]}/plan.pdf`;
  }
  return getJobFloorPlanPdfKey(jobId);
}

export function getSourcePageFromFloorImage(imageStorageKey: string) {
  const match = imageStorageKey.match(/floor-(\d+)\.webp$/i);
  return match ? Number(match[1]) : null;
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
    return `PDF must be at most ${MAX_DRAWING_UPLOAD_MB} MB`;
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

/** Open once, then stream only requested bytes. Closing/cancellation owns the fd. */
export async function openJobRoomFile(storageKey: string) {
  const file = await open(path.join(UPLOAD_ROOT, storageKey), "r");
  try {
    const info = await file.stat({ bigint: true });
    if (!info.isFile() || info.size > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("Invalid drawing file");
    const size = Number(info.size);
    const modified = new Date(Number(info.mtimeMs));
    // Upload files are immutable. Include inode and nanosecond change times so
    // replacements of legacy mutable paths invalidate their cached validator too.
    const etag = `"${info.ino.toString(16)}-${info.size.toString(16)}-${info.mtimeNs.toString(16)}-${info.ctimeNs.toString(16)}"`;
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await file.close();
    };
    return {
      size,
      modified,
      etag,
      close,
      stream(start = 0, end = size - 1) {
        let position = start;
        return new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (closed) return;
            if (position > end) {
              await close();
              controller.close();
              return;
            }
            try {
              const buffer = new Uint8Array(
                Math.min(64 * 1024, end - position + 1),
              );
              const { bytesRead } = await file.read(
                buffer,
                0,
                buffer.length,
                position,
              );
              if (closed) return;
              if (bytesRead === 0)
                throw new Error("Drawing file changed during transfer");
              position += bytesRead;
              controller.enqueue(buffer.subarray(0, bytesRead));
              if (position > end) {
                await close();
                controller.close();
              }
            } catch (error) {
              await close().catch(() => undefined);
              controller.error(error);
            }
          },
          cancel: close,
        });
      },
    };
  } catch (error) {
    await file.close();
    throw error;
  }
}
