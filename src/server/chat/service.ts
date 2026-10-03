import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { db } from "~/server/db";
import {
  jobChatAttachments,
  jobChatEvents,
  jobChatMembers,
  jobChatMessages,
  users,
} from "./tables";
import { userCan } from "~/server/auth/permissions";
import { assertMessageOwner, type ChatAccess } from "./access";
import { requestHash, type ChatMessage } from "./contracts";
import { publishChatEvent } from "./events";
import { enqueueChatPush } from "./push";
import type { ChatTransaction } from "./types";
import type { RequestUser } from "~/server/utils/get-request-identity";

type MessageRow = {
  id: string;
  sequence: number;
  jobId: string;
  clientId: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  authorImage: string | null;
  replyToId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
};
const messageSelection = {
  id: jobChatMessages.id,
  sequence: jobChatMessages.sequence,
  jobId: jobChatMessages.jobId,
  clientId: jobChatMessages.clientId,
  body: jobChatMessages.body,
  authorId: jobChatMessages.authorId,
  authorName: users.name,
  authorImage: users.image,
  replyToId: jobChatMessages.replyToId,
  createdAt: jobChatMessages.createdAt,
  editedAt: jobChatMessages.editedAt,
  deletedAt: jobChatMessages.deletedAt,
};

export async function lockChatJob(tx: ChatTransaction, jobId: string) {
  // Serialize this job's writes before allocating sequence numbers. This prevents
  // a late transaction from committing an older sequence after a read cursor.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${jobId}, 4141))`,
  );
}
async function joinTx(tx: ChatTransaction, access: ChatAccess) {
  await tx
    .insert(jobChatMembers)
    .values({ jobId: access.job.id, userId: access.user.id })
    .onConflictDoNothing();
}
async function hydrate(rows: MessageRow[]): Promise<ChatMessage[]> {
  if (!rows.length) return [];
  const attachments = (await db
    .select()
    .from(jobChatAttachments)
    .where(
      inArray(
        jobChatAttachments.messageId,
        rows
          .filter((r) => !r.deletedAt)
          .map((r) => r.id)
          .concat("00000000-0000-0000-0000-000000000000"),
      ),
    )) as {
    id: string;
    messageId: string;
    name: string;
    mimeType: string;
    size: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    sequence: r.sequence,
    jobId: r.jobId,
    clientId: r.clientId,
    body: r.deletedAt ? "" : r.body,
    author: {
      id: r.authorId,
      name: r.authorName ?? "Former member",
      image: r.authorImage,
    },
    replyToId: r.replyToId,
    createdAt: r.createdAt,
    editedAt: r.editedAt,
    deletedAt: r.deletedAt,
    attachments: r.deletedAt
      ? []
      : attachments
          .filter((a) => a.messageId === r.id)
          .map((a) => ({
            id: a.id,
            name: a.name,
            mimeType: a.mimeType,
            size: a.size,
            url: `/api/job-chat/attachments/${a.id}`,
          })),
  }));
}
async function messageById(jobId: string, id: string) {
  const rows = (await db
    .select(messageSelection)
    .from(jobChatMessages)
    .leftJoin(users, eq(users.id, jobChatMessages.authorId))
    .where(and(eq(jobChatMessages.jobId, jobId), eq(jobChatMessages.id, id)))
    .limit(1)) as MessageRow[];
  const [message] = await hydrate(rows);
  if (!message)
    throw new TRPCError({ code: "NOT_FOUND", message: "Message not found." });
  return message;
}
async function latestSequence(jobId: string) {
  const [row] = await db
    .select({
      sequence: sql<number>`coalesce(max(${jobChatMessages.sequence}),0)::bigint`,
    })
    .from(jobChatMessages)
    .where(eq(jobChatMessages.jobId, jobId));
  return Number(row?.sequence ?? 0);
}
export async function chatOverview(access: ChatAccess) {
  const [member] = (await db
    .select()
    .from(jobChatMembers)
    .where(
      and(
        eq(jobChatMembers.jobId, access.job.id),
        eq(jobChatMembers.userId, access.user.id),
      ),
    )
    .limit(1)) as { muted: boolean; lastReadSequence: number }[];
  const [unread] = await db
    .select({ value: count() })
    .from(jobChatMessages)
    .where(
      and(
        eq(jobChatMessages.jobId, access.job.id),
        gt(jobChatMessages.sequence, member?.lastReadSequence ?? 0),
        isNull(jobChatMessages.deletedAt),
        sql`${jobChatMessages.authorId} is distinct from ${access.user.id}`,
      ),
    );
  return {
    jobName: access.job.name,
    unreadCount: unread?.value ?? 0,
    latestSequence: await latestSequence(access.job.id),
    joined: !!member,
    muted: member?.muted ?? false,
    userId: access.user.id,
    canModerate: access.canModerate,
  };
}
export async function joinChat(access: ChatAccess) {
  await db.transaction(async (tx) => {
    await lockChatJob(tx, access.job.id);
    await joinTx(tx, access);
  });
  return chatOverview(access);
}
export async function chatHistory(
  access: ChatAccess,
  input: { beforeSequence?: number; limit: number },
) {
  const rows = (await db
    .select(messageSelection)
    .from(jobChatMessages)
    .leftJoin(users, eq(users.id, jobChatMessages.authorId))
    .where(
      and(
        eq(jobChatMessages.jobId, access.job.id),
        input.beforeSequence === undefined
          ? undefined
          : lt(jobChatMessages.sequence, input.beforeSequence),
      ),
    )
    .orderBy(desc(jobChatMessages.sequence))
    .limit(input.limit + 1)) as MessageRow[];
  const hasMore = rows.length > input.limit;
  const page = rows.slice(0, input.limit).reverse();
  return {
    messages: await hydrate(page),
    nextBeforeSequence: hasMore ? page[0]!.sequence : null,
    latestSequence: await latestSequence(access.job.id),
  };
}
export async function sendChatMessage(
  access: ChatAccess,
  input: {
    clientId: string;
    body: string;
    replyToId?: string;
    attachmentIds: string[];
  },
) {
  const hash = requestHash(input);
  const result = await db.transaction(async (tx) => {
    await lockChatJob(tx, access.job.id);
    const [existing] = await tx
      .select()
      .from(jobChatMessages)
      .where(
        and(
          eq(jobChatMessages.jobId, access.job.id),
          eq(jobChatMessages.authorId, access.user.id),
          eq(jobChatMessages.clientId, input.clientId),
        ),
      )
      .limit(1);
    if (existing) {
      if (existing.requestHash !== hash)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This message retry has different contents. Send it as a new message.",
        });
      return { id: existing.id, created: false };
    }
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${access.user.id}, 4142))`,
    );
    const [rate] = await tx
      .select({ value: count() })
      .from(jobChatMessages)
      .where(
        and(
          eq(jobChatMessages.authorId, access.user.id),
          sql`${jobChatMessages.createdAt} > now() - interval '1 minute'`,
        ),
      );
    if ((rate?.value ?? 0) >= 30)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Please wait a moment before sending more messages.",
      });
    if (input.replyToId) {
      const [parent] = await tx
        .select({ id: jobChatMessages.id })
        .from(jobChatMessages)
        .where(
          and(
            eq(jobChatMessages.id, input.replyToId),
            eq(jobChatMessages.jobId, access.job.id),
          ),
        )
        .limit(1);
      if (!parent)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Reply must be to a message in this job.",
        });
    }
    if (input.attachmentIds.length) {
      const files = await tx
        .select({ id: jobChatAttachments.id })
        .from(jobChatAttachments)
        .where(
          and(
            inArray(jobChatAttachments.id, input.attachmentIds),
            eq(jobChatAttachments.jobId, access.job.id),
            eq(jobChatAttachments.uploadedById, access.user.id),
            isNull(jobChatAttachments.messageId),
            sql`${jobChatAttachments.createdAt} > now() - interval '24 hours'`,
          ),
        );
      if (files.length !== input.attachmentIds.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "An attachment is unavailable. Upload it again.",
        });
    }
    await joinTx(tx, access);
    const [message] = await tx
      .insert(jobChatMessages)
      .values({
        jobId: access.job.id,
        authorId: access.user.id,
        clientId: input.clientId,
        requestHash: hash,
        body: input.body,
        replyToId: input.replyToId ?? null,
      })
      .returning();
    if (!message) throw new Error("Message insertion failed");
    if (input.attachmentIds.length)
      await tx
        .update(jobChatAttachments)
        .set({ messageId: message.id })
        .where(inArray(jobChatAttachments.id, input.attachmentIds));
    await tx
      .insert(jobChatEvents)
      .values({ jobId: access.job.id, messageId: message.id, type: "created" });
    await enqueueChatPush(tx, {
      organizationId: access.job.organizationId,
      jobId: access.job.id,
      messageId: message.id,
      senderId: access.user.id,
      sequence: message.sequence,
    });
    return { id: message.id, created: true };
  });
  if (result.created) publishChatEvent(access.job.id);
  return messageById(access.job.id, result.id);
}
export async function changeChatMessage(
  access: ChatAccess,
  messageId: string,
  body: string | null,
) {
  await db.transaction(async (tx) => {
    await lockChatJob(tx, access.job.id);
    const [message] = await tx
      .select()
      .from(jobChatMessages)
      .where(
        and(
          eq(jobChatMessages.jobId, access.job.id),
          eq(jobChatMessages.id, messageId),
        ),
      )
      .limit(1);
    if (!message) throw new TRPCError({ code: "NOT_FOUND" });
    assertMessageOwner(access, message.authorId);
    if (message.deletedAt) {
      if (body === null) return; // Repeated delete is safe.
      throw new TRPCError({
        code: "CONFLICT",
        message: "This message was deleted.",
      });
    }
    if (body !== null && body === message.body) return;
    await tx
      .update(jobChatMessages)
      .set(
        body === null
          ? { deletedAt: sql`now()`, body: "" }
          : { body, editedAt: sql`now()` },
      )
      .where(eq(jobChatMessages.id, messageId));
    await tx.insert(jobChatEvents).values({
      jobId: access.job.id,
      messageId,
      type: body === null ? "deleted" : "edited",
    });
  });
  publishChatEvent(access.job.id);
  return messageById(access.job.id, messageId);
}
export async function markChatRead(access: ChatAccess, sequence: number) {
  return db.transaction(async (tx) => {
    await lockChatJob(tx, access.job.id);
    const [last] = await tx
      .select({
        sequence: sql<number>`coalesce(max(${jobChatMessages.sequence}),0)::bigint`,
      })
      .from(jobChatMessages)
      .where(eq(jobChatMessages.jobId, access.job.id));
    const bounded = Math.min(sequence, Number(last?.sequence ?? 0));
    await joinTx(tx, access);
    const [member] = await tx
      .update(jobChatMembers)
      .set({
        lastReadSequence: sql`greatest(${jobChatMembers.lastReadSequence}, ${bounded})`,
      })
      .where(
        and(
          eq(jobChatMembers.jobId, access.job.id),
          eq(jobChatMembers.userId, access.user.id),
        ),
      )
      .returning({ lastReadSequence: jobChatMembers.lastReadSequence });
    return { lastReadSequence: member!.lastReadSequence };
  });
}
export async function setChatNotifications(access: ChatAccess, muted: boolean) {
  await db
    .insert(jobChatMembers)
    .values({ jobId: access.job.id, userId: access.user.id, muted })
    .onConflictDoUpdate({
      target: [jobChatMembers.jobId, jobChatMembers.userId],
      set: { muted },
    });
  return { muted };
}
export async function chatMembers(access: ChatAccess) {
  const rows = (await db
    .select({
      user: users,
      joinedAt: jobChatMembers.joinedAt,
      muted: jobChatMembers.muted,
    })
    .from(users)
    .leftJoin(
      jobChatMembers,
      and(
        eq(jobChatMembers.userId, users.id),
        eq(jobChatMembers.jobId, access.job.id),
      ),
    )
    .where(
      and(
        eq(users.organizationId, access.job.organizationId),
        eq(users.organizationAccessStatus, "approved"),
        or(
          eq(users.currentJobId, access.job.id),
          access.job.createdByUserId
            ? eq(users.id, access.job.createdByUserId)
            : undefined,
          access.job.foremanUserId
            ? eq(users.id, access.job.foremanUserId)
            : undefined,
          sql`${jobChatMembers.joinedAt} is not null`,
        ),
      ),
    )
    .orderBy(asc(users.name))) as unknown as {
    user: RequestUser;
    joinedAt: Date | null;
    muted: boolean | null;
  }[];
  return rows
    .filter((r) => userCan(r.user, "tab.dashboard"))
    .map((r) => ({
      id: r.user.id,
      name: r.user.name ?? "Team member",
      image: r.user.image,
      joined: !!r.joinedAt,
      muted: r.muted ?? false,
    }));
}
