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
import { createHash } from "node:crypto";
import type { z } from "zod";
import { userCan } from "~/server/auth/permissions";
import { requestHash } from "~/server/chat/contracts";
import { users } from "~/server/chat/tables";
import type { ChatTransaction } from "~/server/chat/types";
import { db } from "~/server/db";
import {
  conversationAttachments,
  conversationMembers,
  conversationMessages,
  conversations,
} from "~/server/db/conversation-schema";
import type { RequestUser } from "~/server/utils/get-request-identity";
import type {
  ConversationMessage,
  createConversationInput,
  replaceSnapshotInput,
  savedSnapshotsInput,
  sendConversationInput,
} from "./contracts";
import { enqueueConversationPush } from "./push";
import { publishConversationEvent } from "./events";

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
  const result = await db.transaction(async (tx) => {
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
  publishConversationEvent({ conversationId: result.id, recipients: ids });
  return result;
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
  input: { beforeSequence?: number; limit: number; messageIds?: string[] },
) {
  const rows = await db
    .select({ message: conversationMessages, name: users.name })
    .from(conversationMessages)
    .leftJoin(users, eq(users.id, conversationMessages.authorId))
    .where(
      and(
        eq(conversationMessages.conversationId, access.conversation.id),
        input.messageIds
          ? inArray(conversationMessages.id, input.messageIds)
          : undefined,
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
    source: m.deletedAt ? null : m.source,
    author: {
      id: m.authorId,
      name: typeof name === "string" ? name : access.conversation.directKey?.startsWith("super-scale:") && m.authorId === null ? "ForemanHQ" : "Former member",
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
  const legacyHash = requestHash(input);
  const hash = input.source
    ? createHash("sha256")
        .update(JSON.stringify([legacyHash, input.source]))
        .digest("hex")
    : legacyHash;
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
        source: input.source ?? null,
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
    await enqueueConversationPush(tx, {
      organizationId: access.conversation.organizationId,
      conversationId: access.conversation.id,
      messageId: message.id,
      senderId: access.user.id,
      sequence: message.sequence,
    });
    return message.id;
  });
  publishConversationEvent({
    conversationId: access.conversation.id,
    messageIds: [id],
  });
  return { id };
}
export async function listSavedSnapshots(
  userId: string,
  input: z.infer<typeof savedSnapshotsInput>,
) {
  const user = await conversationUser(userId);
  const search = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
  // Recheck membership and organization on every page; never list a colleague's
  // images or snapshots from conversations the effective user has left.
  const rows = await db
    .select({
      id: conversationMessages.id,
      conversationId: conversationMessages.conversationId,
      sequence: conversationMessages.sequence,
      body: conversationMessages.body,
      source: conversationMessages.source,
      createdAt: conversationMessages.createdAt,
      conversationName: conversations.name,
      imageId: sql<string>`(select a.id from ${conversationAttachments} a
        where a."messageId" = ${conversationMessages.id}
        and a."mimeType" like 'image/%' order by a."createdAt", a.id limit 1)`,
    })
    .from(conversationMessages)
    .innerJoin(
      conversations,
      eq(conversations.id, conversationMessages.conversationId),
    )
    .innerJoin(
      conversationMembers,
      and(
        eq(conversationMembers.conversationId, conversations.id),
        eq(conversationMembers.userId, user.id),
      ),
    )
    .where(
      and(
        eq(conversationMessages.authorId, user.id),
        eq(conversations.organizationId, user.organizationId),
        isNull(conversationMessages.deletedAt),
        input.beforeSequence
          ? lt(conversationMessages.sequence, input.beforeSequence)
          : undefined,
        sql`exists (select 1 from ${conversationAttachments} a
        where a."messageId" = ${conversationMessages.id} and a."mimeType" like 'image/%')`,
        input.search
          ? sql`(${conversationMessages.body} ilike ${search}
        or ${conversationMessages.source}->>'title' ilike ${search}
        or ${conversations.name} ilike ${search})`
          : undefined,
      ),
    )
    .orderBy(desc(conversationMessages.sequence))
    .limit(21);
  const page = rows.slice(0, 20);
  return {
    snapshots: page.map(({ imageId, ...row }) => ({
      ...row,
      imageUrl: `/api/chat/attachments/${imageId}`,
    })),
    nextCursor: rows.length > 20 ? page.at(-1)!.sequence : null,
  };
}
export async function savedConversationSnapshot(
  access: ConversationAccess,
  messageId: string,
) {
  const [message] = await db
    .select()
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.id, messageId),
        eq(conversationMessages.conversationId, access.conversation.id),
        eq(conversationMessages.authorId, access.user.id),
        isNull(conversationMessages.deletedAt),
      ),
    )
    .limit(1);
  const [image] = message
    ? await db
        .select()
        .from(conversationAttachments)
        .where(
          and(
            eq(conversationAttachments.messageId, message.id),
            sql`${conversationAttachments.mimeType} like 'image/%'`,
          ),
        )
        .limit(1)
    : [];
  if (!message || !image)
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        "This snapshot is unavailable. You can only edit your own snapshots.",
    });
  return {
    id: message.id,
    conversationId: message.conversationId,
    revision: message.revision,
    body: message.body,
    source: message.source,
    image: {
      id: image.id,
      name: image.name,
      mimeType: image.mimeType,
      url: `/api/chat/attachments/${image.id}`,
    },
  };
}
export async function replaceConversationSnapshot(
  access: ConversationAccess,
  input: z.infer<typeof replaceSnapshotInput>,
) {
  // Both ends are checked against the current effective identity, including
  // employee simulation. Keep the original until the replacement commits.
  await conversationAccess(access.user.id, access.conversation.id);
  const target = await conversationAccess(
    access.user.id,
    input.targetConversationId,
  );
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const result = await db.transaction(async (tx) => {
    // Stable ordering prevents two cross-conversation remakes deadlocking.
    for (const id of [
      ...new Set([access.conversation.id, target.conversation.id]),
    ].sort())
      await lockConversation(tx, id);
    const [original] = await tx
      .select()
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.id, input.messageId),
          eq(conversationMessages.conversationId, access.conversation.id),
          eq(conversationMessages.authorId, access.user.id),
        ),
      )
      .for("update");
    if (!original)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "This snapshot is unavailable.",
      });
    const [retry] = await tx
      .select()
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, target.conversation.id),
          eq(conversationMessages.authorId, access.user.id),
          eq(conversationMessages.clientId, input.clientId),
        ),
      )
      .limit(1);
    if (retry) {
      if (
        retry.requestHash !== hash ||
        original.editClientId !== input.clientId ||
        original.editRequestHash !== hash
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "This retry has different contents. Reopen the snapshot.",
        });
      return { id: retry.id, removed: [] as string[] };
    }
    if (original.deletedAt || original.revision !== input.expectedRevision)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "This snapshot changed or was deleted. Reopen it before trying again.",
      });
    const originals = await tx
      .select()
      .from(conversationAttachments)
      .where(eq(conversationAttachments.messageId, original.id));
    if (
      !originals.some(
        (file) =>
          file.id === input.originalAttachmentId &&
          file.mimeType.startsWith("image/"),
      )
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "The original snapshot image is no longer available.",
      });
    const [image] = await tx
      .select()
      .from(conversationAttachments)
      .where(
        and(
          eq(conversationAttachments.id, input.attachmentId),
          eq(conversationAttachments.conversationId, target.conversation.id),
          eq(conversationAttachments.uploadedById, access.user.id),
          isNull(conversationAttachments.messageId),
          sql`${conversationAttachments.mimeType} like 'image/%'`,
          sql`${conversationAttachments.createdAt} > now() - interval '24 hours'`,
        ),
      );
    if (!image)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "The new snapshot image is unavailable. Capture it again.",
      });
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
        message: "Please wait before sending more snapshots.",
      });
    const [message] = await tx
      .insert(conversationMessages)
      .values({
        conversationId: target.conversation.id,
        authorId: access.user.id,
        clientId: input.clientId,
        requestHash: hash,
        body: input.body,
        source: input.source,
      })
      .returning();
    if (!message) throw new Error("Snapshot insertion failed");
    await tx
      .update(conversationAttachments)
      .set({ messageId: message.id })
      .where(eq(conversationAttachments.id, image.id));
    await tx
      .update(conversationMessages)
      .set({
        deletedAt: sql`now()`,
        body: "",
        source: null,
        revision: original.revision + 1,
        editClientId: input.clientId,
        editRequestHash: hash,
      })
      .where(eq(conversationMessages.id, original.id));
    await tx
      .delete(conversationAttachments)
      .where(eq(conversationAttachments.messageId, original.id));
    await tx
      .update(conversations)
      .set({ updatedAt: sql`now()` })
      .where(
        inArray(conversations.id, [
          access.conversation.id,
          target.conversation.id,
        ]),
      );
    await enqueueConversationPush(tx, {
      organizationId: target.conversation.organizationId,
      conversationId: target.conversation.id,
      messageId: message.id,
      senderId: access.user.id,
      sequence: message.sequence,
    });
    return { id: message.id, removed: originals.map((file) => file.id) };
  });
  publishConversationEvent({
    conversationId: access.conversation.id,
    messageIds: [input.messageId],
  });
  publishConversationEvent({
    conversationId: target.conversation.id,
    messageIds: [result.id],
  });
  if (result.removed.length) {
    const { removeReplacedConversationFile } = await import("./attachments");
    await Promise.all(
      result.removed.map((id) => removeReplacedConversationFile(id)),
    );
  }
  return { id: result.id };
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
  publishConversationEvent({
    conversationId: access.conversation.id,
    recipients: [access.user.id],
    readOnly: true,
  });
  return { success: true };
}
export async function removeConversationMessage(
  access: ConversationAccess,
  messageId: string,
) {
  await db.transaction(async (tx) => {
    await lockConversation(tx, access.conversation.id);
    const [row] = await tx
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
    await tx
      .update(conversations)
      .set({ updatedAt: sql`clock_timestamp()` })
      .where(eq(conversations.id, access.conversation.id));
  });
  publishConversationEvent({
    conversationId: access.conversation.id,
    messageIds: [messageId],
  });
  return { success: true };
}
