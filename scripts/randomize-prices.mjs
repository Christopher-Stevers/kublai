import 'dotenv/config';
import postgres from 'postgres';
import { writeFileSync } from 'node:fs';

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const cost4 = (min, max) => (Math.round((min + Math.random() * (max - min)) * 10000) / 10000).toFixed(4);

const backup = await sql.begin(async (tx) => {
  const supplierParts = await tx`select id, "lastKnownUnitCost" from kublai_supplier_part order by id`;
  const quoteItems = await tx`select id, quantity, "supplierPartId", "unitCost", "extendedPrice" from kublai_quote_item order by id`;

  const backup = {
    createdAt: new Date().toISOString(),
    supplierParts,
    quoteItems,
  };

  for (const row of supplierParts) {
    await tx`update kublai_supplier_part set "lastKnownUnitCost" = ${cost4(1.25, 249.95)} where id = ${row.id}`;
  }

  const updatedSupplierParts = await tx`select id, "lastKnownUnitCost" from kublai_supplier_part`;
  const supplierCostById = new Map(updatedSupplierParts.map((row) => [row.id, Number(row.lastKnownUnitCost ?? 0)]));

  for (const row of quoteItems) {
    const qty = Number(row.quantity ?? 1);
    const unitCost = row.supplierPartId && supplierCostById.has(row.supplierPartId)
      ? supplierCostById.get(row.supplierPartId)
      : Number(cost4(1.25, 249.95));
    const extendedPrice = Math.round(qty * unitCost * 100) / 100;

    await tx`
      update kublai_quote_item
      set "unitCost" = ${unitCost.toFixed(4)},
          "extendedPrice" = ${extendedPrice.toFixed(2)},
          "updatedAt" = now()
      where id = ${row.id}
    `;
  }

  return backup;
});

const backupPath = `/home/halvor/.openclaw/workspace/kublai/state-price-backup-${Date.now()}.json`;
writeFileSync(backupPath, JSON.stringify(backup, null, 2));

const [counts] = await sql`
  select
    (select count(*)::int from kublai_supplier_part) as supplier_parts,
    (select count(*)::int from kublai_quote_item) as quote_items,
    (select count(*)::int from kublai_quote_item where "unitCost" is null or "extendedPrice" is null) as unpriced_quote_items
`;
const sample = await sql`
  select qi.id, qi.quantity, qi."unitCost", qi."extendedPrice", sp."lastKnownUnitCost"
  from kublai_quote_item qi
  left join kublai_supplier_part sp on sp.id = qi."supplierPartId"
  order by qi."updatedAt" desc
  limit 5
`;

await sql.end();
console.log(JSON.stringify({ backupPath, counts, sample }, null, 2));
