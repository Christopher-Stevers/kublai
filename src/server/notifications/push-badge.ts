import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "~/server/db";
import type { RequestUser } from "~/server/utils/get-request-identity";
import { notificationAccount, notificationOverview } from "./service";

/** Reuse inbox semantics so background pushes and the open app agree. */
export async function withPushBadge(payload: string, recipientId?: string) {
  if (!recipientId) return payload;
  try {
    const data = JSON.parse(payload) as Record<string, unknown>;
    if (data.account !== createHash("sha256").update(recipientId).digest("hex")) return payload;
    const [user] = await db.execute<RequestUser>(sql`select * from kublai_user where id=${recipientId}`);
    if (!user || !notificationAccount(user)) return payload;
    const { unreadCount } = await notificationOverview({db, user, userId:recipientId});
    return JSON.stringify({...data, badgeCount:unreadCount});
  } catch {
    // Badge enrichment must not block the message notification on query failure.
    return payload;
  }
}
