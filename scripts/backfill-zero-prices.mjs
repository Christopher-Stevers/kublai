import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const cost4 = (min, max) => (Math.round((min + Math.random() * (max - min)) * 10000) / 10000).toFixed(4);

const result = await sql.begin(async (tx) => {
  const zeroSupplierParts = await tx`
    select id from kublai_supplier_part
    where "lastKnownUnitCost" is null or "lastKnownUnitCost"::numeric <= 0
  `;

  for (const row of zeroSupplierParts) {
    await tx`
      update kublai_supplier_part
      set "lastKnownUnitCost" = ${cost4(1.25, 249.95)}
      where id = ${row.id}
    `;
  }

  const zeroItems = await tx`
    select qi.id, qi.quantity, qi."supplierPartId", sp."lastKnownUnitCost"
    from kublai_quote_item qi
    left join kublai_supplier_part sp on sp.id = qi."supplierPartId"
    where qi."unitCost" is null
       or qi."unitCost"::numeric <= 0
       or qi."extendedPrice" is null
       or qi."extendedPrice"::numeric <= 0
  `;

  for (const row of zeroItems) {
    const qty = Number(row.quantity ?? 1);
    const unitCost = row.lastKnownUnitCost ? Number(row.lastKnownUnitCost) : Number(cost4(1.25, 249.95));
    const extendedPrice = Math.round(qty * unitCost * 100) / 100;

    await tx`
      update kublai_quote_item
      set "unitCost" = ${unitCost.toFixed(4)},
          "extendedPrice" = ${extendedPrice.toFixed(2)},
          "updatedAt" = now()
      where id = ${row.id}
    `;
  }

  const [remaining] = await tx`
    select
      (select count(*)::int from kublai_supplier_part where "lastKnownUnitCost" is null or "lastKnownUnitCost"::numeric <= 0) as zero_supplier_parts,
      (select count(*)::int from kublai_quote_item where "unitCost" is null or "unitCost"::numeric <= 0 or "extendedPrice" is null or "extendedPrice"::numeric <= 0) as zero_items
  `;

  return {
    supplierPartsBackfilled: zeroSupplierParts.length,
    itemsBackfilled: zeroItems.length,
    remaining,
  };
});

await sql.end();
console.log(JSON.stringify(result, null, 2));
