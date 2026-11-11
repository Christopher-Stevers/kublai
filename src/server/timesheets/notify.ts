import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { transactionalBackgroundHint } from "~/server/background/hints";
import type { db } from "~/server/db";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Called inside the same transaction as the durable event. PostgreSQL delivers
 * only after commit; a rollback discards both the write and notification. */
export async function notifyTimesheetChange(
  tx: Pick<Transaction, "execute">,
  organizationId: string,
  userId: string,
  organizationWide = false,
) {
  const payload = transactionalBackgroundHint({
    topic: "timesheets",
    organizationId,
    scope: organizationWide ? "organization" : "personal",
    ...(organizationWide ? {} : { userId }),
    eventId: randomUUID(),
  });
  await tx.execute(sql`select pg_notify('foremanhq_change', ${payload})`);
}
