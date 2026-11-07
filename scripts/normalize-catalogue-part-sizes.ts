import "dotenv/config";
import postgres from "postgres";
import { mkdirSync, writeFileSync } from "node:fs";
import { normalizePartSize } from "../src/lib/part-size-input";

type CatalogueSizeRow = Record<string, unknown> & {
  id: string;
  organizationId: string;
  sizeLabel: string | null;
  sizeId: string | null;
  nominal: string | null;
  unitId: string | null;
  unit: string | null;
};

// Run without arguments to inspect; --apply writes in one transaction with a backup.
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const apply = process.argv.includes("--apply");
try {
  await sql.begin(async (tx) => {
    // postgres's TransactionSql uses Omit, which drops its template call signature.
    const query = tx as unknown as postgres.Sql;
    const rows = await query<
      CatalogueSizeRow[]
    >`select p.*,s.nominal,s."unitId",u.code unit from kublai_part_definition p left join kublai_size s on s.id=p."sizeId" left join kublai_unit u on u.id=s."unitId" order by p.id for update of p`;
    const units = await query<
      { id: string; code: string }[]
    >`select id,code from kublai_unit`;
    const plan: Array<{
      id: string;
      organizationId: string;
      label: string;
      nominal: number;
      unitId: string;
      oldSizeId: string | null;
    }> = [];
    const issues: unknown[] = [];
    for (const row of rows) {
      if (!row.sizeLabel) continue;
      const original = String(row.sizeLabel);
      const foundUnits = new Set<string>();
      if (/["″”]|\b(?:inches|inch|in)\b/i.test(original)) foundUnits.add("in");
      if (/['′]|\b(?:feet|foot|ft)\b/i.test(original)) foundUnits.add("ft");
      if (/\bmm\b/i.test(original)) foundUnits.add("mm");
      const explicitUnit = [...foundUnits][0];
      const unitCode = row.unit ?? explicitUnit;
      // Preserve descriptive qualifiers in the untouched part name.
      const numeric = original
        .replace(/\bO\.?D\.[.]*/gi, "")
        .replace(/\bon\b/gi, "x")
        .replace(/\b(?:inches|inch|in|feet|foot|ft|mm)\b|["″”'′]/gi, "")
        .replace(/×/g, "x");
      const label = normalizePartSize(numeric);
      const unit = units.find((item) => item.code === unitCode);
      const nominal = label ? Number(label.split(" x ")[0]) : NaN;
      if (
        !label ||
        !unit ||
        foundUnits.size > 1 ||
        (explicitUnit && row.unit && explicitUnit !== row.unit) ||
        !Number.isFinite(nominal)
      ) {
        issues.push({ id: row.id, sizeLabel: original, unit: row.unit, label });
        continue;
      }
      if (
        row.nominal !== null &&
        Math.abs(Number(row.nominal) - nominal) > 0.000001
      ) {
        issues.push({
          id: row.id,
          sizeLabel: original,
          nominal: row.nominal,
          parsed: nominal,
        });
        continue;
      }
      if (label !== original || !row.sizeId)
        plan.push({
          id: String(row.id),
          organizationId: String(row.organizationId),
          label,
          nominal,
          unitId: String(unit.id),
          oldSizeId: row.sizeId,
        });
    }
    console.log(
      JSON.stringify(
        {
          total: rows.length,
          changes: plan.length,
          missingUnitLinks: plan.filter((item) => !item.oldSizeId).length,
          issues,
        },
        null,
        2,
      ),
    );
    if (issues.length)
      throw new Error("Review unresolved sizes before applying changes.");
    if (!apply) return;
    const directory = `.tmp/size-cleanup/${new Date().toISOString().replace(/[:.]/g, "-")}`;
    mkdirSync(directory, { recursive: true });
    writeFileSync(`${directory}/before.json`, JSON.stringify(rows, null, 2));
    writeFileSync(`${directory}/plan.json`, JSON.stringify(plan, null, 2));
    for (const item of plan) {
      let sizeId = item.oldSizeId;
      if (!sizeId) {
        const [size] = await query<
          { id: string }[]
        >`insert into kublai_size (id,"organizationId",nominal,"unitId","createdAt") values (${crypto.randomUUID()},${item.organizationId},${item.nominal},${item.unitId},now()) on conflict ("organizationId",nominal,"unitId") do update set nominal=excluded.nominal returning id`;
        sizeId = String(size!.id);
      }
      await query`update kublai_part_definition set "sizeLabel"=${item.label},"sizeId"=${sizeId} where id=${item.id}`;
    }
    const after = await query<
      CatalogueSizeRow[]
    >`select p.*,s.nominal,s."unitId",u.code unit from kublai_part_definition p left join kublai_size s on s.id=p."sizeId" left join kublai_unit u on u.id=s."unitId" order by p.id`;
    const expected = new Map(plan.map((item) => [item.id, item]));
    if (after.length !== rows.length) throw new Error("Part count changed");
    for (let i = 0; i < after.length; i++) {
      const before = rows[i]!;
      const current = after[i]!;
      const change = expected.get(String(current.id));
      if (
        current.sizeLabel &&
        (!current.unit ||
          normalizePartSize(String(current.sizeLabel)) !== current.sizeLabel)
      )
        throw new Error(`Invalid normalized size: ${current.id}`);
      for (const key of Object.keys(before)) {
        if (
          change &&
          ["sizeLabel", "sizeId", "nominal", "unitId", "unit"].includes(key)
        )
          continue;
        if (JSON.stringify(before[key]) !== JSON.stringify(current[key]))
          throw new Error(`Unexpected change to ${current.id}.${key}`);
      }
    }
    console.log(
      JSON.stringify({
        applied: plan.length,
        verified: after.length,
        backup: directory,
      }),
    );
  });
} finally {
  await sql.end();
}
