import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { db } from "~/server/db";
import {
  conversations,
  conversationMembers,
  conversationMessages,
} from "~/server/db/conversation-schema";
import { enqueueConversationPush } from "~/server/conversations/push";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Same transaction as completion: one private message per completed run, even after retries. */
export async function notifySuperScale(
  tx: Transaction,
  job: { id: string; userId: string; organizationId: string },
  body: string,
  reviewUrl: string,
) {
  const directKey =
    "super-scale:" +
    createHash("sha256").update(job.userId).digest("hex").slice(0, 52);
  const [chat] = await tx
    .insert(conversations)
    .values({
      organizationId: job.organizationId,
      kind: "group",
      name: "Super scale",
      directKey,
      createdById: job.userId,
    })
    .onConflictDoUpdate({
      target: [conversations.organizationId, conversations.directKey],
      set: { updatedAt: new Date() },
    })
    .returning();
  await tx
    .insert(conversationMembers)
    .values({ conversationId: chat!.id, userId: job.userId })
    .onConflictDoNothing();
  const [message] = await tx
    .insert(conversationMessages)
    .values({
      id: job.id,
      conversationId: chat!.id,
      authorId: null,
      clientId: job.id,
      requestHash: createHash("sha256").update(body).digest("hex"),
      body,
      source: reviewUrl
        ? {
            href: reviewUrl,
            title: "Review Super scale results",
            capturedAt: new Date().toISOString(),
          }
        : null,
    })
    .onConflictDoNothing()
    .returning();
  if (message)
    await enqueueConversationPush(tx, {
      organizationId: job.organizationId,
      conversationId: chat!.id,
      messageId: message.id,
      senderId: "foremanhq-super-scale",
      sequence: message.sequence,
    });
  await tx
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, chat!.id));
}
