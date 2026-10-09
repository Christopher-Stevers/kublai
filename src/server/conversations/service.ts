import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  sql,
} from "drizzle-orm";
import { db } from "~/server/db";
import { users } from "~/server/chat/tables";
import { userCan } from "~/server/auth/permissions";
import type { RequestUser } from "~/server/utils/get-request-identity";
import {
  conversations,
  conversationMembers,
  conversationMessages,
  conversationAttachments,
} from "~/server/db/conversation-schema";
import { requestHash } from "~/server/chat/contracts";
import type { ChatTransaction } from "~/server/chat/types";
import type {
  ConversationMessage,
  createConversationInput,
  sendConversationInput,
} from "./contracts";
import type { z } from "zod";

export function checkConversationUser(user: RequestUser | null) {
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (
    !user.organizationId ||
    user.organizationAccessStatus !== "approved" ||
    !userCan(user, "tab.dashboard")
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Approved organization and dashboard access are required.",
    });
  return { ...user, organizationId: user.organizationId };
}
export async function conversationUser(userId: string | null | undefined) {
  if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return checkConversationUser((user ?? null) as RequestUser | null);
}
export async function conversationAccess(
  userId: string | null | undefined,
  conversationId: string,
) {
  const user = await conversationUser(userId);
  const [row] = await db
    .select({ conversation: conversations, member: conversationMembers })
    .from(conversations)
    .innerJoin(
      conversationMembers,
      and(
        eq(conversationMembers.conversationId, conversations.id),
        eq(conversationMembers.userId, user.id),
      ),
    )
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, user.organizationId),
      ),
    )
    .limit(1);
  if (!row)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Conversation not found.",
    });
  return { user, ...row };
}
export type ConversationAccess = Awaited<ReturnType<typeof conversationAccess>>;
export async function lockConversation(tx: ChatTransaction, id: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${id}, 4151))`,
  );
}
export async function conversationPeople(userId: string) {
  const user = await conversationUser(userId);
  const rows = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.organizationId, user.organizationId),
        eq(users.organizationAccessStatus, "approved"),
      ),
    )
    .limit(1000);
  return (rows as RequestUser[])
    .filter((v) => v.id !== user.id && userCan(v, "tab.dashboard"))
    .map((v) => ({
      id: v.id,
      name: v.name ?? v.email,
      email: v.email,
      image: v.image,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export async function createConversation(
  userId: string,
  input: z.infer<typeof createConversationInput>,
) {
  const user = await conversationUser(userId);
  const ids = [...new Set([user.id, ...input.recipientIds])].sort();
  if (ids.length < 2 || (input.kind === "direct" && ids.length !== 2))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Choose one person for a direct conversation, or people for a group.",
    });
  const rows = await db.select().from(users).where(inArray(users.id, ids));
  if (
    rows.length !== ids.length ||
    (rows as RequestUser[]).some(
      (v) =>
        v.organizationId !== user.organizationId ||
        v.organizationAccessStatus !== "approved" ||
        !userCan(v, "tab.dashboard"),
    )
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose approved people in your organization.",
    });
  if (input.kind === "group" && !input.name)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Give the group a name.",
    });
  const directKey =
    input.kind === "direct"
      ? createHash("sha256").update(JSON.stringify(ids)).digest("hex")
      : null;
  return db.transaction(async (tx) => {
    // A stable lock makes simultaneous starts/retries reuse a direct conversation.
    await lockConversation(tx, directKey ?? user.id);
    if (directKey) {
      const [existing] = await tx
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.organizationId, user.organizationId),
            eq(conversations.directKey, directKey),
          ),
        )
        .limit(1);
      if (existing) return { id: existing.id };
    }
    const [created] = await tx
      .insert(conversations)
      .values({
        organizationId: user.organizationId,
        kind: input.kind,
        name: input.name,
        directKey,
        createdById: user.id,
      })
      .returning();
    if (!created) throw new Error("Could not start conversation");
    await tx
      .insert(conversationMembers)
      .values(ids.map((id) => ({ conversationId: created.id, userId: id })));
    return { id: created.id };
  });
}
export async function listConversations(userId: string) {
  const user = await conversationUser(userId);
  const rows = await db
    .select({
      conversation: conversations,
      read: conversationMembers.lastReadSequence,
    })
    .from(conversations)
    .innerJoin(
      conversationMembers,
      and(
        eq(conversationMembers.conversationId, conversations.id),
        eq(conversationMembers.userId, user.id),
      ),
    )
    .where(eq(conversations.organizationId, user.organizationId))
    .orderBy(desc(conversations.updatedAt))
    .limit(100);
  if (!rows.length) return { userId: user.id, conversations: [] };
  const ids = rows.map((r) => r.conversation.id);
  const members = await db
    .select({
      conversationId: conversationMembers.conversationId,
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(inArray(conversationMembers.conversationId, ids));
  const unread = await db
    .select({
      conversationId: conversationMessages.conversationId,
      count: count(),
    })
    .from(conversationMessages)
    .innerJoin(
      conversationMembers,
      and(
        eq(
          conversationMembers.conversationId,
          conversationMessages.conversationId,
        ),
        eq(conversationMembers.userId, user.id),
      ),
    )
    .where(
      and(
        inArray(conversationMessages.conversationId, ids),
        gt(conversationMessages.sequence, conversationMembers.lastReadSequence),
        isNull(conversationMessages.deletedAt),
        sql`${conversationMessages.authorId} is distinct from ${user.id}`,
      ),
    )
    .groupBy(conversationMessages.conversationId);
  return {
    userId: user.id,
    conversations: rows.map(({ conversation }) => {
      const people = members
        .filter((m) => m.conversationId === conversation.id)
        .map((m) => ({ id: String(m.id), name: String(m.name ?? m.email) }));
      return {
        ...conversation,
        name:
          conversation.kind === "group"
            ? conversation.name
            : (people.find((m) => m.id !== user.id)?.name ?? "Former member"),
        members: people,
        unreadCount:
          unread.find((r) => r.conversationId === conversation.id)?.count ?? 0,
      };
    }),
  };
}
export async function conversationHistory(
  access: ConversationAccess,
  input: { beforeSequence?: number; limit: number },
) {
  const rows = await db
    .select({ message: conversationMessages, name: users.name })
    .from(conversationMessages)
    .leftJoin(users, eq(users.id, conversationMessages.authorId))
    .where(
      and(
        eq(conversationMessages.conversationId, access.conversation.id),
        input.beforeSequence === undefined
          ? undefined
          : lt(conversationMessages.sequence, input.beforeSequence),
      ),
    )
    .orderBy(desc(conversationMessages.sequence))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit).reverse();
  const files = page.length
    ? await db
        .select()
        .from(conversationAttachments)
        .where(
          inArray(
            conversationAttachments.messageId,
            page
              .filter((r) => !r.message.deletedAt)
              .map((r) => r.message.id)
              .concat("00000000-0000-0000-0000-000000000000"),
          ),
        )
    : [];
  const messages: ConversationMessage[] = page.map(({ message: m, name }) => ({
    ...m,
    body: m.deletedAt ? "" : m.body,
    author: {
      id: m.authorId,
      name: typeof name === "string" ? name : "Former member",
    },
    attachments: m.deletedAt
      ? []
      : files
          .filter((a) => a.messageId === m.id)
          .map((a) => ({
            id: a.id,
            name: a.name,
            mimeType: a.mimeType,
            size: a.size,
            url: `/api/chat/attachments/${a.id}`,
          })),
  }));
  return {
    messages,
    nextBeforeSequence:
      rows.length > input.limit ? page[0]!.message.sequence : null,
  };
}
export async function sendConversationMessage(
  access: ConversationAccess,
  input: z.infer<typeof sendConversationInput>,
) {
  const hash = requestHash(input);
  const id = await db.transaction(async (tx) => {
    await lockConversation(tx, access.conversation.id);
    const [existing] = await tx
      .select()
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, access.conversation.id),
          eq(conversationMessages.authorId, access.user.id),
          eq(conversationMessages.clientId, input.clientId),
        ),
      )
      .limit(1);
    if (existing) {
      if (existing.requestHash !== hash)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This retry has different contents. Send it as a new message.",
        });
      return existing.id;
    }
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${access.user.id}, 4152))`,
    );
    const [rate] = await tx
      .select({ value: count() })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.authorId, access.user.id),
          sql`${conversationMessages.createdAt} > now() - interval '1 minute'`,
        ),
      );
    if ((rate?.value ?? 0) >= 30)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Please wait before sending more messages.",
      });
    if (input.attachmentIds.length) {
      const files = await tx
        .select({ id: conversationAttachments.id })
        .from(conversationAttachments)
        .where(
          and(
            inArray(conversationAttachments.id, input.attachmentIds),
            eq(conversationAttachments.conversationId, access.conversation.id),
            eq(conversationAttachments.uploadedById, access.user.id),
            isNull(conversationAttachments.messageId),
            sql`${conversationAttachments.createdAt} > now() - interval '24 hours'`,
          ),
        );
      if (files.length !== input.attachmentIds.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "An attachment is unavailable. Upload it again.",
        });
    }
    const [message] = await tx
      .insert(conversationMessages)
      .values({
        conversationId: access.conversation.id,
        authorId: access.user.id,
        clientId: input.clientId,
        requestHash: hash,
        body: input.body,
      })
      .returning();
    if (!message) throw new Error("Message insertion failed");
    if (input.attachmentIds.length)
      await tx
        .update(conversationAttachments)
        .set({ messageId: message.id })
        .where(inArray(conversationAttachments.id, input.attachmentIds));
    await tx
      .update(conversations)
      .set({ updatedAt: sql`now()` })
      .where(eq(conversations.id, access.conversation.id));
    return message.id;
  });
  return { id };
}
export async function markConversationRead(
  access: ConversationAccess,
  sequence: number,
) {
  const [latest] = await db
    .select({
      value: sql<number>`coalesce(max(${conversationMessages.sequence}),0)`,
    })
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, access.conversation.id));
  await db
    .update(conversationMembers)
    .set({
      lastReadSequence: sql`greatest(${conversationMembers.lastReadSequence},${Math.min(sequence, Number(latest?.value ?? 0))})`,
    })
    .where(
      and(
        eq(conversationMembers.conversationId, access.conversation.id),
        eq(conversationMembers.userId, access.user.id),
      ),
    );
  return { success: true };
}
export async function removeConversationMessage(
  access: ConversationAccess,
  messageId: string,
) {
  const [row] = await db
    .update(conversationMessages)
    .set({ deletedAt: sql`now()`, body: "" })
    .where(
      and(
        eq(conversationMessages.id, messageId),
        eq(conversationMessages.conversationId, access.conversation.id),
        eq(conversationMessages.authorId, access.user.id),
      ),
    )
    .returning({ id: conversationMessages.id });
  if (!row)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "You can only delete your own messages.",
    });
  return { success: true };
}
