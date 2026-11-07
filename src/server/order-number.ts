import { sql } from "drizzle-orm";
import type { db } from "~/server/db";

export function materialOrderReference(sequence: number, supplierName: string) {
  const supplier = supplierName.replace(/\s+/g, " ").trim() || "Supplier";
  const prefix = `${sequence}-`;
  return prefix + Array.from(supplier).slice(0, 100 - prefix.length).join("");
}

/** One durable company counter, shared across suppliers and jobs. */
export async function nextMaterialOrderNumber(
  tx: Pick<typeof db, "execute">,
  organizationId: string,
  supplierName: string,
) {
  const result = await tx.execute<{ lastNumber: number }>(sql`
    insert into kublai_order_number_counter ("organizationId", "lastNumber")
    select ${organizationId}::uuid,
      coalesce(max(substring("orderNumber" from '^(?:ORDER-|PO-)?([0-9]{1,9})(?:-|$)')::int), 0) + 1
    from kublai_order where "organizationId" = ${organizationId}::uuid and kind = 'materials'
    on conflict ("organizationId") do update
      set "lastNumber" = greatest(kublai_order_number_counter."lastNumber", excluded."lastNumber" - 1) + 1
    returning "lastNumber"
  `);
  return materialOrderReference(result[0]!.lastNumber, supplierName);
}
