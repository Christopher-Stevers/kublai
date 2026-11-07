#!/usr/bin/env node
// @ts-nocheck
require("dotenv/config");

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const postgres = require("postgres");

const sourcePath = path.join(process.cwd(), "data/catalogue/pvc-dwv-catalogue.json");
const TIM_EMAIL = process.env.PVC_DWV_IMPORT_USER_EMAIL || "tim.j.saunders@gmail.com";

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return normalize(value).toLowerCase();
}

function parseSizeNumber(sizeNominal) {
  const first = normalize(sizeNominal).split(/\s*(?:x|×)\s*/i)[0] ?? "";
  const mixed = /^(\d+)\s*[- ]\s*(\d+)\/(\d+)$/.exec(first);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\/(\d+)$/.exec(first);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const number = Number(first);
  return Number.isFinite(number) ? number : null;
}

function decimalToFraction(num) {
  if (Number.isInteger(num)) return String(num);
  const whole = Math.floor(Math.abs(num));
  const fractional = Math.abs(num) - whole;
  const sixteenths = Math.round(fractional * 16);
  if (sixteenths === 0) return String(num < 0 ? -whole : whole);
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(sixteenths, 16);
  return `${num < 0 ? "-" : ""}${whole > 0 ? `${whole}-` : ""}${sixteenths / divisor}/${16 / divisor}`;
}

function formatSizeLabel(sizeNominal, sizeUnit = "in") {
  const suffix = normalizeKey(sizeUnit) === "mm" ? " mm" : "\"";
  return normalize(sizeNominal)
    .split(/\s*(?:x|×)\s*/i)
    .map((part) => {
      const parsed = parseSizeNumber(part);
      return (parsed == null ? part : decimalToFraction(parsed)) + suffix;
    })
    .join(" x ");
}

async function ensureNamed(sql, table, organizationId, name, extra = {}) {
  const [existing] =
    await sql`select id, name from ${sql(table)} where "organizationId" = ${organizationId} and lower(name) = lower(${name}) limit 1`;
  if (existing) return existing;
  const values = { id: randomUUID(), organizationId, name, ...extra };
  const [created] =
    await sql`insert into ${sql(table)} ${sql([values], Object.keys(values))} returning id, name`;
  return created;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const rows = data.rows ?? [];
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10, idle_timeout: 5 });
  try {
    const [user] =
      await sql`select id, email, "organizationId" from kublai_user where lower(email) = lower(${TIM_EMAIL}) limit 1`;
    if (!user?.organizationId) throw new Error(`No organization found for ${TIM_EMAIL}`);
    const organizationId = user.organizationId;
    const existingPvcDwv = await sql`
      select pd.id, pd."displayName"
      from kublai_part_definition pd
      left join kublai_material m on m.id = pd."materialId"
      where pd."organizationId" = ${organizationId} and m.name = 'PVC DWV'`;

    const backupDir = path.join(process.cwd(), "state-backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `pvc-dwv-catalogue-backup-${Date.now()}.json`);
    fs.writeFileSync(
      backupPath,
      JSON.stringify({ createdAt: new Date().toISOString(), sourcePath, existingPvcDwv }, null, 2),
    );

    const catalog = await ensureNamed(sql, "kublai_catalog", organizationId, "Plumbing", {
      sortOrder: 0,
      createdAt: new Date(),
    });
    const category = await ensureNamed(sql, "kublai_category", organizationId, "Fitting", {
      sortOrder: 1,
    });
    const material = await ensureNamed(sql, "kublai_material", organizationId, "PVC DWV", {
      createdAt: new Date(),
    });
    const units =
      await sql`select id, code from kublai_unit where lower(code) in ('in', 'inch', 'mm') order by code`;
    const inchUnit = units.find((item) => ["in", "inch"].includes(normalizeKey(item.code)));
    const mmUnit = units.find((item) => normalizeKey(item.code) === "mm");
    if (!inchUnit) throw new Error("No inch unit found");
    if (!mmUnit) throw new Error("No mm unit found");

    const byName = new Map(existingPvcDwv.map((part) => [normalizeKey(part.displayName), part.id]));
    let inserted = 0;
    let updated = 0;
    for (const [index, row] of rows.entries()) {
      const sizeNumber = parseSizeNumber(row.sizeNominal);
      if (sizeNumber == null) throw new Error(`Cannot parse size for ${row.displayName}`);
      const unit = normalizeKey(row.sizeUnit) === "mm" ? mmUnit : inchUnit;
      const sizeLabel = normalize(row.sizeLabel) || formatSizeLabel(row.sizeNominal, row.sizeUnit);
      const [size] = await sql`
        insert into kublai_size (id, "organizationId", nominal, "unitId", "createdAt")
        values (${randomUUID()}, ${organizationId}, ${String(sizeNumber)}, ${unit.id}, ${new Date()})
        on conflict ("organizationId", nominal, "unitId") do update set nominal = excluded.nominal
        returning id`;
      const existingId = byName.get(normalizeKey(row.displayName));
      const partId = existingId ?? randomUUID();
      if (existingId) {
        await sql`
          update kublai_part_definition
          set "catalogId" = ${catalog.id}, "categoryId" = ${category.id}, "displayName" = ${row.displayName},
              description = ${normalize(row.description)}, "imageUrl" = ${normalize(row.imageUrl) || null},
              "sizeLabel" = ${sizeLabel}, "materialId" = ${material.id},
              "sizeId" = ${size.id}, "isActive" = true
          where id = ${partId}`;
        updated += 1;
      } else {
        await sql`
          insert into kublai_part_definition (id, "organizationId", "catalogId", "categoryId", "displayName", description, "imageUrl", "sizeLabel", "materialId", "sizeId", "isActive", "createdAt")
          values (${partId}, ${organizationId}, ${catalog.id}, ${category.id}, ${row.displayName}, ${normalize(row.description)}, ${normalize(row.imageUrl) || null}, ${sizeLabel}, ${material.id}, ${size.id}, true, ${new Date()})`;
        byName.set(normalizeKey(row.displayName), partId);
        inserted += 1;
      }
      await sql`delete from kublai_part_synonym where "partDefinitionId" = ${partId}`;
      const aliases = [...new Set((row.aliases ?? []).map(normalize).filter(Boolean))];
      if (aliases.length) {
        await sql`insert into kublai_part_synonym ${sql(
          aliases.map((synonym) => ({ id: randomUUID(), partDefinitionId: partId, synonym })),
          ["id", "partDefinitionId", "synonym"],
        )}`;
      }
      if ((index + 1) % 50 === 0 || index + 1 === rows.length) {
        console.log(`PVC DWV bulk import progress: ${index + 1}/${rows.length}`);
      }
    }
    console.log(JSON.stringify({ ok: true, backupPath, inserted, updated, upserted: inserted + updated }, null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
