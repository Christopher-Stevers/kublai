import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { db } from "~/server/db";
import {
  conversationAttachments,
  conversationMessages,
} from "~/server/db/conversation-schema";
import {
  readBoundedBody,
  safeFileName,
  validateAttachment,
} from "~/server/chat/attachments";
import {
  conversationAccess,
  lockConversation,
  type ConversationAccess,
} from "./service";
const root = path.resolve(
  process.env.CONVERSATION_UPLOAD_DIR ??
    path.join(process.cwd(), "uploads", "conversation-chat"),
);
export async function uploadConversationAttachment(
  access: ConversationAccess,
  request: Request,
) {
  const mimeType =
    request.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  let name: string;
  try {
    name = safeFileName(
      decodeURIComponent(request.headers.get("x-file-name") ?? "attachment"),
    );
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid filename." });
  }
  const bytes = await readBoundedBody(request);
  await validateAttachment(bytes, mimeType);
  await conversationAccess(access.user.id, access.conversation.id);
  const id = randomUUID();
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(path.join(root, id), bytes, { flag: "wx", mode: 0o600 });
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${access.user.id},4152))`,
      );
      const [rate] = await tx
        .select({
          files: count(),
          bytes: sql<number>`coalesce(sum(${conversationAttachments.size}),0)`,
        })
        .from(conversationAttachments)
        .where(
          and(
            eq(conversationAttachments.uploadedById, access.user.id),
            sql`${conversationAttachments.createdAt} > now() - interval '24 hours'`,
          ),
        );
      const [pending] = await tx
        .select({ value: count() })
        .from(conversationAttachments)
        .where(
          and(
            eq(conversationAttachments.uploadedById, access.user.id),
            isNull(conversationAttachments.messageId),
            sql`${conversationAttachments.createdAt} > now() - interval '24 hours'`,
          ),
        );
      if (
        (rate?.files ?? 0) >= 100 ||
        Number(rate?.bytes ?? 0) + bytes.length > 200 * 1024 * 1024 ||
        (pending?.value ?? 0) >= 10
      )
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message:
            "Attachment limit reached. Send or remove pending files before uploading more.",
        });
      await tx.insert(conversationAttachments).values({
        id,
        conversationId: access.conversation.id,
        uploadedById: access.user.id,
        name,
        mimeType,
        size: bytes.length,
      });
    });
  } catch (error) {
    await unlink(path.join(root, id)).catch(() => undefined);
    throw error;
  }
  return {
    id,
    name,
    mimeType,
    size: bytes.length,
    url: `/api/chat/attachments/${id}`,
  };
}
export async function readConversationAttachment(
  userId: string | null,
  id: string,
) {
  const [attachment] = await db
    .select()
    .from(conversationAttachments)
    .where(eq(conversationAttachments.id, id))
    .limit(1);
  if (!attachment) throw new TRPCError({ code: "NOT_FOUND" });
  await conversationAccess(userId, attachment.conversationId);
  if (!attachment.messageId) {
    if (
      attachment.uploadedById !== userId ||
      attachment.createdAt.getTime() < Date.now() - 86400000
    )
      throw new TRPCError({ code: "NOT_FOUND" });
  } else {
    const [message] = await db
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.id, attachment.messageId),
          eq(conversationMessages.conversationId, attachment.conversationId),
          isNull(conversationMessages.deletedAt),
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
export async function deleteConversationAttachment(
  userId: string | null,
  id: string,
) {
  const [attachment] = await db
    .select()
    .from(conversationAttachments)
    .where(eq(conversationAttachments.id, id))
    .limit(1);
  if (!attachment) return;
  await conversationAccess(userId, attachment.conversationId);
  if (attachment.uploadedById !== userId)
    throw new TRPCError({ code: "FORBIDDEN" });
  const deleted = await db.transaction(async (tx) => {
    await lockConversation(tx, attachment.conversationId);
    return tx
      .delete(conversationAttachments)
      .where(
        and(
          eq(conversationAttachments.id, id),
          isNull(conversationAttachments.messageId),
        ),
      )
      .returning({ id: conversationAttachments.id });
  });
  if (!deleted.length)
    throw new TRPCError({
      code: "CONFLICT",
      message: "This attachment is already part of a message.",
    });
  await unlink(path.join(root, id)).catch(() => undefined);
}
export async function cleanupExpiredConversationAttachments() {
  const files = await db.execute<{ id: string }>(
    sql`delete from ${conversationAttachments} where ${conversationAttachments.id} in (select ${conversationAttachments.id} from ${conversationAttachments} where ${conversationAttachments.messageId} is null and ${conversationAttachments.createdAt} < now() - interval '24 hours' order by ${conversationAttachments.createdAt} limit 100 for update skip locked) returning ${conversationAttachments.id} as id`,
  );
  for (const file of files)
    await unlink(path.join(root, file.id)).catch(() => undefined);
  return files.length;
}
