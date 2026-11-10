import { sql } from "drizzle-orm";
import type { db } from "~/server/db";

export function materialOrderReference(sequence: number, supplierName: string) {
  const supplier = supplierName.replace(/\s+/g, " ").trim() || "Supplier";
  const prefix = `${sequence}-`;
  return prefix + Array.from(supplier).slice(0, 100 - prefix.length).join("");
}

/** Allocate inside the same transaction that inserts the order. The job lock
 * serializes suppliers/senders; gaps are reusable after an order is removed. */
export async function nextMaterialOrderNumber(
  tx: Pick<typeof db, "execute">,
  organizationId: string,
  jobId: string,
  supplierName: string,
) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${organizationId}:${jobId}:orders`}))`);
  const result = await tx.execute<{ nextNumber: number }>(sql`
    with used as (
      select distinct substring("orderNumber" from '^(?:ORDER-|PO-)?([0-9]{1,9})(?:-|$)')::int as n
      from kublai_order
      where "organizationId" = ${organizationId}::uuid
        and "jobId" = ${jobId}::uuid and kind = 'materials'
    ), candidates as (
      select 1 as n union select n + 1 from used where n > 0
    )
    select min(c.n)::int as "nextNumber" from candidates c
    where not exists (select 1 from used u where u.n = c.n)
  `);
  return materialOrderReference(result[0]!.nextNumber, supplierName);
}
