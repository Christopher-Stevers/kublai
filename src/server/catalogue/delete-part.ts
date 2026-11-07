import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { db } from "~/server/db";
type Database = Pick<typeof db, "execute">;
const metadata = new Set(["kublai_part_attribute", "kublai_part_synonym", "kublai_supplier_part"]);
const labels: Record<string, string> = {
  kublai_quote_item: "material list / quote entries", kublai_order_item: "order entries",
  kublai_asset: "inventory assets", kublai_asset_stock: "inventory stock records",
  kublai_asset_movement: "inventory history entries", kublai_asset_count_line: "inventory count entries",
  kublai_material_prefab_item: "prefab entries", kublai_job_price_entry: "job price entries",
};

/** Inspect the database's actual foreign keys so newly added usages fail closed. */
export async function partDeletionUsage(database: Database, organizationId: string, partId: string, lock = false) {
  const parts = await database.execute<{ displayName: string }>(sql`
    select "displayName" from kublai_part_definition
    where id=${partId} and "organizationId"=${organizationId} ${lock ? sql`for update` : sql``}`);
  if (!parts[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Part not found." });
  // Supplier-only references also count as usage. Lock these before checking
  // so a concurrent reference cannot slip between the check and deletion.
  await database.execute(sql`select id from kublai_supplier_part where "partDefinitionId"=${partId} ${lock ? sql`for update` : sql``}`);
  const references = await database.execute<{ schema: string; table: string; column: string; parent: string }>(sql`
    select ns.nspname as schema, t.relname as table, a.attname as column, p.relname as parent
    from pg_constraint c join pg_class t on t.oid=c.conrelid
    join pg_namespace ns on ns.oid=t.relnamespace join pg_class p on p.oid=c.confrelid
    join pg_attribute a on a.attrelid=t.oid and a.attnum=any(c.conkey)
    where c.contype='f' and c.confrelid in ('kublai_part_definition'::regclass,'kublai_supplier_part'::regclass)`);
  const usages: { label: string; count: number }[] = [];
  for (const ref of references) {
    if (metadata.has(ref.table)) continue;
    const table = sql`${sql.identifier(ref.schema)}.${sql.identifier(ref.table)}`;
    const column = sql.identifier(ref.column);
    const match = ref.parent === "kublai_part_definition"
      ? sql`${column}=${partId}`
      : sql`${column} in (select id from kublai_supplier_part where "partDefinitionId"=${partId})`;
    const rows = await database.execute<{ count: number }>(sql`select count(*)::int as count from ${table} where ${match}`);
    if (rows[0]?.count) usages.push({ label: labels[ref.table] ?? "related records", count: rows[0].count });
  }
  return { name: parts[0].displayName, canDelete: usages.length === 0, usages };
}

export async function permanentlyDeletePart(database: typeof db, organizationId: string, partId: string) {
  return database.transaction(async tx => {
    const usage = await partDeletionUsage(tx, organizationId, partId, true);
    if (!usage.canDelete) throw new TRPCError({ code: "CONFLICT", message: `This part is used in ${[...new Set(usage.usages.map(item => item.label))].join(", ")}. Hide it from the catalogue instead; existing records will be preserved.` });
    await tx.execute(sql`delete from kublai_part_definition where id=${partId} and "organizationId"=${organizationId}`);
    return { deleted: true };
  });
}
