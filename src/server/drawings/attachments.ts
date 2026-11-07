import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

export const MAX_DRAWING_ATTACHMENT_BYTES = 10 * 1024 * 1024;
let activeUploads = 0;
/** Bound decoded-photo memory before accepting the request body. */
export async function withDrawingAttachmentSlot<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (activeUploads >= 2)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Photo uploads are busy. Try again shortly.",
    });
  activeUploads++;
  try {
    return await operation();
  } finally {
    activeUploads--;
  }
}
const infoSchema = z.object({
  name: z.string().max(180),
  mime: z.enum(["application/pdf", "image/webp"]),
  authorId: z.string(),
  sheetId: z.string().uuid(),
});
function directory(jobId: string, fileId: string) {
  return path.join(
    process.cwd(),
    "uploads",
    "drawing-attachments",
    z.string().uuid().parse(jobId),
    z.string().uuid().parse(fileId),
  );
}
export async function drawingAttachmentInfo(jobId: string, fileId: string) {
  try {
    return infoSchema.parse(
      JSON.parse(
        await readFile(
          path.join(directory(jobId, fileId), "info.json"),
          "utf8",
        ),
      ),
    );
  } catch {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Drawing attachment not found.",
    });
  }
}
export async function readDrawingAttachment(jobId: string, fileId: string) {
  const info = await drawingAttachmentInfo(jobId, fileId);
  return {
    ...info,
    bytes: await readFile(path.join(directory(jobId, fileId), "content")),
  };
}
export async function writeDrawingAttachment(input: {
  jobId: string;
  sheetId: string;
  authorId: string;
  name: string;
  bytes: Buffer;
}) {
  if (!input.bytes.length || input.bytes.length > MAX_DRAWING_ATTACHMENT_BYTES)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "Choose a photo or PDF under 10 MB.",
    });
  let bytes: Buffer, mime: "application/pdf" | "image/webp";
  if (input.bytes.subarray(0, 5).toString("ascii") === "%PDF-") {
    // Served as a download, never embedded as executable same-origin content.
    bytes = input.bytes;
    mime = "application/pdf";
  } else {
    try {
      const image = sharp(input.bytes, {
        limitInputPixels: 40_000_000,
        animated: false,
      });
      const metadata = await image.metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format ?? ""))
        throw Error("Unsupported image");
      bytes = await image
        .rotate()
        .resize({
          width: 3000,
          height: 3000,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 88 })
        .toBuffer();
      mime = "image/webp";
    } catch {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose a JPEG, PNG, WebP photo or PDF.",
      });
    }
  }
  if (bytes.length > MAX_DRAWING_ATTACHMENT_BYTES)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "The converted photo is too large. Choose a smaller photo.",
    });
  const fileId = randomUUID(),
    folder = directory(input.jobId, fileId);
  const baseName =
    input.name
      .replace(/[\x00-\x1f\x7f/\\]/g, "")
      .trim()
      .slice(0, 165) || "Attachment";
  const name =
    mime === "image/webp"
      ? baseName.replace(/\.[a-z0-9]+$/i, "") + ".webp"
      : baseName.replace(/\.pdf$/i, "") + ".pdf";
  const info = infoSchema.parse({
    name,
    mime,
    authorId: input.authorId,
    sheetId: input.sheetId,
  });
  await mkdir(folder, { recursive: true, mode: 0o700 });
  try {
    await writeFile(path.join(folder, "content"), bytes, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(path.join(folder, "info.json"), JSON.stringify(info), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    await rm(folder, { force: true, recursive: true });
    throw error;
  }
  return {
    url: `/api/drawings/attachments/${input.jobId}/${fileId}`,
    name,
    mime,
  };
}
