import { open, readFile } from "node:fs/promises";
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
  const match = imageStorageKey.match(/floor-(\d+)\.webp$/i);
  return match ? Number(match[1]) : null;
}

export async function readJobRoomFile(storageKey: string) {
  return readFile(path.join(UPLOAD_ROOT, storageKey));
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
