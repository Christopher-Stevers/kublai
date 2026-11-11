import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { transactionalBackgroundHint } from "~/server/background/hints";
import type { ChatAccess } from "./access";
import type { ChatTransaction } from "./types";

/** Optional post-commit wake-up. A savepoint isolates NOTIFY errors from the
 * business write; the outer transaction still governs delivery/rollback. */
export async function notifyChatOverviewChange(
  tx: ChatTransaction,
  access: ChatAccess,
) {
  try {
    await tx.transaction(async (savepoint) => {
      const payload = transactionalBackgroundHint({
        topic: "chat-overview",
        organizationId: access.job.organizationId,
        userId: access.user.id,
        jobId: access.job.id,
        eventId: randomUUID(),
      });
      await savepoint.execute(
        sql`select pg_notify('foremanhq_change', ${payload})`,
      );
    });
  } catch {
    // Polling stays authoritative; never replay the business write for a hint.
  }
}
