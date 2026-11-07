import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import sharp from "sharp";
import { db } from "~/server/db";
import { jobChatAttachments, jobChatMessages } from "./tables";
import { assertChatAccess, type ChatAccess } from "./access";
import { lockChatJob } from "./service";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const root = path.resolve(process.cwd(), "uploads", "job-chat");
const mimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);
export async function readBoundedBody(
  request: Request,
  limit = MAX_ATTACHMENT_BYTES,
) {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit))
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "Files must be 10 MB or smaller.",
    });
  if (!request.body)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Empty file." });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, 60_000);
  try {
    while (true) {
      const chunk = await reader.read();
      if (timedOut)
        throw new TRPCError({
          code: "TIMEOUT",
          message: "Upload timed out. Please try again.",
        });
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > limit) {
        await reader.cancel();
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: "Files must be 10 MB or smaller.",
        });
      }
      chunks.push(chunk.value);
    }
  } finally {
    clearTimeout(deadline);
    reader.releaseLock();
  }
  if (!size)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Empty file." });
  return Buffer.concat(chunks);
}
export function safeFileName(name: string) {
  return (
    path
      .basename(name.replaceAll("\\", "/"))
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 200) || "attachment"
  );
}
export async function validateAttachment(data: Buffer, mimeType: string) {
  if (!mimeTypes.has(mimeType))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Attach a JPEG, PNG, WebP, GIF, or PDF.",
    });
  if (mimeType === "application/pdf") {
    if (data.subarray(0, 5).toString("ascii") !== "%PDF-")
      throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid PDF." });
    return;
  }
  try {
    const metadata = await sharp(data, {
      limitInputPixels: 40_000_000,
    }).metadata();
    const expected = {
      "image/jpeg": "jpeg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
    }[mimeType];
    if (
      metadata.format !== expected ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > 40_000_000
    )
      throw new Error("format mismatch");
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid or oversized image.",
    });
  }
}
export async function uploadChatAttachment(
  access: ChatAccess,
  request: Request,
) {
  const mimeType =
    request.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!mimeTypes.has(mimeType))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Attach a JPEG, PNG, WebP, GIF, or PDF.",
    });
  let name: string;
  try {
    name = safeFileName(
      decodeURIComponent(request.headers.get("x-file-name") ?? "attachment"),
    );
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid file name." });
  }
  const bytes = await readBoundedBody(request);
  await validateAttachment(bytes, mimeType);
  // A mobile upload may take a while; account/job access could change mid-upload.
  await assertChatAccess(access.user.id, access.job.id);
  const id = randomUUID();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const filePath = path.join(root, id);
  await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
  try {
    await db.transaction(async (tx) => {
      // Shared uploader lock bounds concurrent uploads across different jobs.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${access.user.id}, 4142))`,
      );
      const [rate] = await tx
        .select({
          files: count(),
          bytes: sql<number>`coalesce(sum(${jobChatAttachments.size}),0)`,
        })
        .from(jobChatAttachments)
        .where(
          and(
            eq(jobChatAttachments.uploadedById, access.user.id),
            sql`${jobChatAttachments.createdAt} > now() - interval '24 hours'`,
          ),
        );
      if (
        (rate?.files ?? 0) >= 100 ||
        Number(rate?.bytes ?? 0) + bytes.length > 200 * 1024 * 1024
      )
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Daily attachment limit reached.",
        });
      const [pending] = await tx
        .select({ value: count() })
        .from(jobChatAttachments)
        .where(
          and(
            eq(jobChatAttachments.uploadedById, access.user.id),
            isNull(jobChatAttachments.messageId),
            sql`${jobChatAttachments.createdAt} > now() - interval '24 hours'`,
          ),
        );
      if ((pending?.value ?? 0) >= 10)
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Send or remove pending attachments before uploading more.",
        });
      await tx.insert(jobChatAttachments).values({
        id,
        jobId: access.job.id,
        uploadedById: access.user.id,
        name,
        mimeType,
        size: bytes.length,
      });
    });
  } catch (error) {
    await unlink(filePath).catch(() => undefined);
    throw error;
  }
  return {
    id,
    name,
    mimeType,
    size: bytes.length,
    url: `/api/job-chat/attachments/${id}`,
  };
}
export async function readChatAttachment(userId: string | null, id: string) {
  const [attachment] = await db
    .select()
    .from(jobChatAttachments)
    .where(eq(jobChatAttachments.id, id))
    .limit(1);
  if (!attachment) throw new TRPCError({ code: "NOT_FOUND" });
  await assertChatAccess(userId, attachment.jobId);
  if (!attachment.messageId) {
    if (
      attachment.uploadedById !== userId ||
      new Date(attachment.createdAt).getTime() <
        Date.now() - 24 * 60 * 60 * 1000
    )
      throw new TRPCError({ code: "NOT_FOUND" });
  } else {
    const [message] = await db
      .select({ id: jobChatMessages.id })
      .from(jobChatMessages)
      .where(
        and(
          eq(jobChatMessages.id, attachment.messageId),
          eq(jobChatMessages.jobId, attachment.jobId),
          isNull(jobChatMessages.deletedAt),
        ),
      )
      .limit(1);
    if (!message) throw new TRPCError({ code: "NOT_FOUND" });
  }
  try {
    return {
      data: await readFile(path.join(root, id)),
      name: attachment.name,
      mimeType: attachment.mimeType,
    };
  } catch {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
}
export async function deletePendingAttachment(
  userId: string | null,
  id: string,
) {
  const [attachment] = await db
    .select()
    .from(jobChatAttachments)
    .where(eq(jobChatAttachments.id, id))
    .limit(1);
  if (!attachment) return;
  const access = await assertChatAccess(userId, attachment.jobId);
  if (attachment.uploadedById !== userId)
    throw new TRPCError({ code: "FORBIDDEN" });
  const removed = await db.transaction(async (tx) => {
    await lockChatJob(tx, access.job.id);
    return tx
      .delete(jobChatAttachments)
      .where(
        and(
          eq(jobChatAttachments.id, id),
          isNull(jobChatAttachments.messageId),
        ),
      )
      .returning({ id: jobChatAttachments.id });
  });
  if (!removed.length)
    throw new TRPCError({
      code: "CONFLICT",
      message: "The attachment is already part of a message.",
    });
  await unlink(path.join(root, id)).catch(() => undefined);
}

/** Bounded maintenance; pending uploads expire after 24 hours and cannot be sent. */
export async function cleanupExpiredChatAttachments() {
  const expired = await db.execute<{ id: string }>(sql`
    delete from ${jobChatAttachments}
    where ${jobChatAttachments.id} in (
      select ${jobChatAttachments.id} from ${jobChatAttachments}
      where ${jobChatAttachments.messageId} is null
      and ${jobChatAttachments.createdAt} < now() - interval '24 hours'
      order by ${jobChatAttachments.createdAt} limit 100
      for update skip locked
    ) returning ${jobChatAttachments.id} as id
  `);
  for (const file of expired)
    await unlink(path.join(root, file.id)).catch(() => undefined);
  return expired.length;
}
