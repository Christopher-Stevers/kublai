#!/usr/bin/env node
// @ts-nocheck
require("dotenv/config");

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const postgres = require("postgres");

const sourcePath = path.join(
  process.cwd(),
  "data/catalogue/gasketed-sdr-catalogue.json",
);
const TIM_EMAIL =
  process.env.GASKETED_SDR_IMPORT_USER_EMAIL || "tim.j.saunders@gmail.com";
const SOURCE_MATERIAL = "Gasketed SDR";
const TARGET_MATERIALS = new Set(["Gasketed DR35", "Gasketed DR25"]);

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return normalize(value).toLowerCase();
}

function parseSizeNumber(sizeNominal) {
  const first = normalize(sizeNominal)
    .replace(/\s*on\s*/i, " x ")
    .split(/\s*(?:x|×)\s*/i)[0] ?? "";
  const mixed = /^(\d+)\s*[- ]\s*(\d+)\/(\d+)$/.exec(first);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\/(\d+)$/.exec(first);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const number = Number(first);
  return Number.isFinite(number) ? number : null;
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
  const seen = new Set();
  for (const row of rows) {
    if (row.catalog !== "Plumbing") throw new Error(`Bad catalog: ${row.displayName}`);
    if (row.category !== "Fitting") throw new Error(`Bad category: ${row.displayName}`);
    if (!TARGET_MATERIALS.has(row.material)) throw new Error(`Bad material: ${row.displayName}`);
    if (/\bS?DR\d+\b/i.test(row.description ?? "")) {
      throw new Error(`Description still contains SDR/DR wording: ${row.displayName}`);
    }
    if (!row.sourceCode) throw new Error(`Missing source code: ${row.displayName}`);
    if (parseSizeNumber(row.sizeNominal) == null) throw new Error(`Bad size: ${row.displayName}`);
    const key = normalizeKey(row.displayName);
    if (seen.has(key)) throw new Error(`Duplicate display name in source: ${row.displayName}`);
    seen.add(key);
  }

  if (!process.env.DATABASE_URL) {
    console.log(JSON.stringify({ ok: true, sourcePath, rows: rows.length, database: "skipped" }, null, 2));
    return;
  }

  const apply = process.argv.includes("--apply");
  if (!apply) {
    console.log(JSON.stringify({ ok: true, sourcePath, rows: rows.length, apply: false }, null, 2));
    return;
  }

  const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
  });

  try {
    const [user] =
      await sql`select id, email, "organizationId" from kublai_user where lower(email) = lower(${TIM_EMAIL}) limit 1`;
    if (!user?.organizationId) throw new Error(`No organization found for ${TIM_EMAIL}`);
    const organizationId = user.organizationId;

    const existing = await sql`
      select pd.*, c.name as "categoryName", m.name as "materialName"
      from kublai_part_definition pd
      left join kublai_category c on c.id = pd."categoryId"
      left join kublai_material m on m.id = pd."materialId"
      where pd."organizationId" = ${organizationId}
        and m.name in ${sql([SOURCE_MATERIAL, ...TARGET_MATERIALS])}`;

    const backupDir = path.join(process.cwd(), "state-backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(
      backupDir,
      `gasketed-materials-catalogue-backup-${Date.now()}.json`,
    );
    fs.writeFileSync(
      backupPath,
      JSON.stringify({ createdAt: new Date().toISOString(), sourcePath, existing }, null, 2),
    );

    const catalog = await ensureNamed(sql, "kublai_catalog", organizationId, "Plumbing", {
      sortOrder: 0,
      createdAt: new Date(),
    });
    const category = await ensureNamed(sql, "kublai_category", organizationId, "Fitting", {
      sortOrder: 1,
    });
    const materialByName = new Map();
    for (const materialName of TARGET_MATERIALS) {
      const material = await ensureNamed(sql, "kublai_material", organizationId, materialName, {
        createdAt: new Date(),
      });
      materialByName.set(materialName, material);
    }
    const [inchUnit] =
      await sql`select id, code from kublai_unit where lower(code) in ('in', 'inch') order by code limit 1`;
    if (!inchUnit) throw new Error("No inch unit found");

    const byDisplayName = new Map();
    for (const part of existing.filter((part) => TARGET_MATERIALS.has(part.materialName))) {
      byDisplayName.set(normalizeKey(part.displayName), part.id);
    }

    const sizeMap = new Map();
    for (const sizeNumber of [
      ...new Set(rows.map((row) => String(parseSizeNumber(row.sizeNominal)))),
    ]) {
      const [size] = await sql`
        insert into kublai_size (id, "organizationId", nominal, "unitId", "createdAt")
        values (${randomUUID()}, ${organizationId}, ${sizeNumber}, ${inchUnit.id}, ${new Date()})
        on conflict ("organizationId", nominal, "unitId") do update set nominal = excluded.nominal
        returning id, nominal`;
      sizeMap.set(sizeNumber, size.id);
    }

    let inserted = 0;
    let updated = 0;
    const newParts = [];
    const aliasRows = [];
    const partIdsForAliasReset = [];

    for (const row of rows) {
      const sizeNumber = parseSizeNumber(row.sizeNominal);
      const sizeId = sizeMap.get(String(sizeNumber));
      if (!sizeId) throw new Error(`Size not created for ${row.displayName}`);
      const material = materialByName.get(row.material);
      if (!material) throw new Error(`Material not created for ${row.displayName}`);

      const existingId = byDisplayName.get(normalizeKey(row.displayName));
      const partId = existingId ?? randomUUID();
      if (existingId) {
        await sql`
          update kublai_part_definition
          set "catalogId" = ${catalog.id}, "categoryId" = ${category.id}, "displayName" = ${row.displayName},
              description = ${normalize(row.description)}, "imageUrl" = ${normalize(row.imageUrl) || null},
              "sizeLabel" = ${normalize(row.sizeLabel)}, "materialId" = ${material.id},
              "sizeId" = ${sizeId}, "isActive" = true
          where id = ${partId}`;
        updated += 1;
      } else {
        newParts.push({
          id: partId,
          organizationId,
          catalogId: catalog.id,
          categoryId: category.id,
          displayName: row.displayName,
          description: normalize(row.description),
          imageUrl: normalize(row.imageUrl) || null,
          sizeLabel: normalize(row.sizeLabel),
          materialId: material.id,
          sizeId,
          isActive: true,
          createdAt: new Date(),
        });
        inserted += 1;
      }

      partIdsForAliasReset.push(partId);
      const aliases = [...new Set((row.aliases ?? []).map(normalize).filter(Boolean))];
      for (const synonym of aliases) {
        aliasRows.push({ id: randomUUID(), partDefinitionId: partId, synonym });
      }
    }

    if (newParts.length) {
      await sql`insert into kublai_part_definition ${sql(newParts, [
        "id",
        "organizationId",
        "catalogId",
        "categoryId",
        "displayName",
        "description",
        "imageUrl",
        "sizeLabel",
        "materialId",
        "sizeId",
        "isActive",
        "createdAt",
      ])}`;
    }

    if (partIdsForAliasReset.length) {
      await sql`delete from kublai_part_synonym where "partDefinitionId" in ${sql(partIdsForAliasReset)}`;
    }
    if (aliasRows.length) {
      await sql`insert into kublai_part_synonym ${sql(aliasRows, [
        "id",
        "partDefinitionId",
        "synonym",
      ])}`;
    }

    const sourceMaterialParts = existing
      .filter((part) => part.materialName === SOURCE_MATERIAL)
      .map((part) => part.id);
    if (sourceMaterialParts.length) {
      await sql`delete from kublai_part_synonym where "partDefinitionId" in ${sql(sourceMaterialParts)}`;
      await sql`delete from kublai_part_definition where id in ${sql(sourceMaterialParts)}`;
    }

    console.log(JSON.stringify({
      ok: true,
      sourcePath,
      backupPath,
      inserted,
      updated,
      deletedSourceMaterialParts: sourceMaterialParts.length,
      upserted: inserted + updated,
    }, null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
