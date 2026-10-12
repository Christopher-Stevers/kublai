import { EventEmitter } from "node:events";
import { and, eq, sql } from "drizzle-orm";
import { db } from "~/server/db";
import {
  conversations,
  conversationMembers,
} from "~/server/db/conversation-schema";
import { conversationUser } from "./service";

export type ConversationEvent = {
  conversationId: string;
  messageIds?: string[];
  recipients?: string[];
  readOnly?: boolean;
};
const shared = globalThis as unknown as { __conversationEvents?: EventEmitter };
const emitter = (shared.__conversationEvents ??= new EventEmitter());
emitter.setMaxListeners(1000);
/** Post-commit hints only. The authorized database snapshot remains authoritative. */
export function publishConversationEvent(event: ConversationEvent) {
  emitter.emit("change", event);
}
export function subscribeConversationEvents(
  listener: (event: ConversationEvent) => void,
) {
  emitter.on("change", listener);
  return () => {
    emitter.off("change", listener);
  };
}
export async function conversationEventSnapshot(userId: string) {
  const user = await conversationUser(userId);
  const rows = await db
    .select({
      id: conversations.id,
      // Preserve PostgreSQL microseconds; JS Dates would miss rapid edits.
      updated: sql<string>`${conversations.updatedAt}::text`,
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
    .where(eq(conversations.organizationId, user.organizationId));
  return new Map(rows.map((row) => [row.id, `${row.updated}:${row.read}`]));
}
