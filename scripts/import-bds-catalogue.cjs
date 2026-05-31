#!/usr/bin/env node
// @ts-nocheck
require("dotenv/config");

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const postgres = require("postgres");

const DEFAULT_SOURCE = path.join(process.cwd(), "data/catalogue/bds-catalogue.json");
const TIM_EMAIL = process.env.BDS_IMPORT_USER_EMAIL || "tim.j.saunders@gmail.com";
const VALID_CATALOG = "Plumbing";
const VALID_MATERIAL = "BDS";
const VALID_CATEGORIES = new Set(["Pipe", "Fitting"]);

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const validateOnly = args.has("--validate-only");
const sourceArg = process.argv.find((arg) => arg.startsWith("--source="));
const sourcePath = sourceArg ? path.resolve(sourceArg.slice("--source=".length)) : DEFAULT_SOURCE;

function normalize(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return normalize(value).toLowerCase();
}

function parseSizeNumber(sizeNominal) {
  const first = normalize(sizeNominal).split(/\s*(?:x|×)\s*/i)[0] || "";
  const mixed = /^(\d+)\s*[- ]\s*(\d+)\/(\d+)$/.exec(first);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const decimal = Number(first);
  if (Number.isFinite(decimal)) return decimal;
  const fraction = /^(\d+)\/(\d+)$/.exec(first);
  return fraction ? Number(fraction[1]) / Number(fraction[2]) : null;
}

function sourceCodeAlias(code) {
  return "IPEX Product Code " + code;
}

function collectValidation(data) {
  const errors = [];
  const warnings = [];
  const codes = new Map();
  const names = new Map();
  for (const [index, row] of (data.rows || []).entries()) {
    const label = "row " + (index + 1) + " (" + (row.displayName || row.sourceCode || "unnamed") + ")";
    if (row.catalog !== VALID_CATALOG) errors.push(label + ": catalog must be " + VALID_CATALOG);
    if (!VALID_CATEGORIES.has(row.category)) errors.push(label + ": category must be Pipe or Fitting");
    if (row.material !== VALID_MATERIAL) errors.push(label + ": material must be " + VALID_MATERIAL);
    if (normalize(row.description)) warnings.push(label + ": BDS description is not blank");
    if (normalize(row.imageUrl)) errors.push(label + ": imageUrl must be blank unless source provides a real part image URL");
    if (!normalize(row.sourceCode)) errors.push(label + ": sourceCode is required");
    if (!Array.isArray(row.manufacturerSources) || row.manufacturerSources.length === 0) {
      errors.push(label + ": manufacturerSources is required");
    }
    if (parseSizeNumber(row.sizeNominal) == null) errors.push(label + ": cannot parse sizeNominal");
    const code = normalize(row.sourceCode);
    if (codes.has(code)) errors.push(label + ": duplicates source code at " + codes.get(code));
    codes.set(code, label);
    const nameKey = normalizeKey(row.displayName);
    if (names.has(nameKey)) errors.push(label + ": duplicate displayName at " + names.get(nameKey));
    names.set(nameKey, label);
  }
  return { errors, warnings };
}

async function one(sql, query, params) {
  return (await sql.unsafe(query, params))[0];
}

async function ensureNamed(sql, table, organizationId, name, extra) {
  const existing = await one(sql, 'select id, name from "' + table + '" where "organizationId" = $1 and lower(name) = lower($2) limit 1', [organizationId, name]);
  if (existing) return existing;
  const values = Object.assign({ id: randomUUID(), organizationId, name }, extra || {});
  const keys = Object.keys(values);
  const columns = keys.map((key) => '"' + key + '"').join(", ");
  const placeholders = keys.map((_, index) => "$" + (index + 1)).join(", ");
  return one(sql, 'insert into "' + table + '" (' + columns + ") values (" + placeholders + ") returning id, name", keys.map((key) => values[key]));
}

function likelyGeneratedDescription(description, row) {
  const desc = normalizeKey(description);
  if (!desc) return true;
  const displayTail = normalizeKey(row.displayName)
    .replace(/^\d+(?:\.\d+)?(?:"| in)?(?:\s*x\s*\d+(?:\.\d+)?(?:"| in)?)*\s+bds\s+/, "");
  const aliases = (row.aliases || []).map(normalizeKey);
  return desc === displayTail || aliases.includes(desc);
}

async function main() {
  if (!fs.existsSync(sourcePath)) throw new Error("Source file not found: " + sourcePath);
  const data = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const rows = data.rows || [];
  const validation = collectValidation(Object.assign({}, data, { rows }));
  if (validation.errors.length) {
    console.error(JSON.stringify({ ok: false, apply, sourcePath, validation }, null, 2));
    process.exit(1);
  }
  if (validateOnly || !process.env.DATABASE_URL) {
    console.log(JSON.stringify({
      ok: true,
      apply,
      sourcePath,
      rows: rows.length,
      validation,
      database: validateOnly ? "skipped: --validate-only" : "skipped: DATABASE_URL is not set",
    }, null, 2));
    return;
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10, idle_timeout: 5, prepare: false });
  try {
    const user = await one(sql, 'select id, email, "organizationId" from kublai_user where lower(email) = lower($1) limit 1', [TIM_EMAIL]);
    if (!user || !user.organizationId) throw new Error("No organization found for " + TIM_EMAIL);
    const organizationId = user.organizationId;
    const existingBds = await sql.unsafe(
      'select pd.*, c.name as "catalogName", cat.name as "categoryName", m.name as "materialName", ' +
        'array_agg(s.synonym) filter (where s.synonym is not null) as synonyms ' +
        'from kublai_part_definition pd ' +
        'left join kublai_catalog c on c.id = pd."catalogId" ' +
        'left join kublai_category cat on cat.id = pd."categoryId" ' +
        'left join kublai_material m on m.id = pd."materialId" ' +
        'left join kublai_part_synonym s on s."partDefinitionId" = pd.id ' +
        'where pd."organizationId" = $1 and m.name = $2 ' +
        'group by pd.id, c.name, cat.name, m.name',
      [organizationId, VALID_MATERIAL],
    );

    let backupPath = null;
    if (apply) {
      const backupDir = path.join(process.cwd(), "state-backups");
      fs.mkdirSync(backupDir, { recursive: true });
      backupPath = path.join(backupDir, "bds-catalogue-backup-" + Date.now() + ".json");
      fs.writeFileSync(
        backupPath,
        JSON.stringify({ createdAt: new Date().toISOString(), sourcePath, existingBds }, null, 2),
      );
    }

    const byCode = new Map();
    const byName = new Map();
    for (const part of existingBds) {
      byName.set(normalizeKey(part.displayName), part);
      for (const synonym of part.synonyms || []) {
        const code = (/^IPEX Product Code\s+(\d{6})$/i.exec(normalize(synonym)) || [])[1] || (/^\d{6}$/.exec(normalize(synonym)) || [])[0];
        if (code) byCode.set(code, part);
      }
    }

    const wouldInsert = rows.filter((row) => !byCode.has(row.sourceCode) && !byName.has(normalizeKey(row.displayName))).length;
    const wouldUpdate = rows.length - wouldInsert;
    if (!apply) {
      console.log(JSON.stringify({
        ok: true,
        apply,
        sourcePath,
        rows: rows.length,
        validation,
        summary: {
          mode: "dry-run",
          organizationId,
          backupPath,
          sourceRows: rows.length,
          existingBds: existingBds.length,
          wouldInsert,
          wouldUpdate,
        },
      }, null, 2));
      return;
    }

    const catalog = await ensureNamed(sql, "kublai_catalog", organizationId, VALID_CATALOG, { sortOrder: 0, createdAt: new Date() });
    const material = await ensureNamed(sql, "kublai_material", organizationId, VALID_MATERIAL, { createdAt: new Date() });
    const unit = await one(sql, "select id from kublai_unit where lower(code) in ('in', 'inch') order by code limit 1", []);
    if (!unit) throw new Error("No inch unit found");
    const categories = new Map();
    for (const categoryName of [...new Set(rows.map((row) => row.category))]) {
      const category = await ensureNamed(sql, "kublai_category", organizationId, categoryName, { sortOrder: categoryName === "Pipe" ? 0 : 1 });
      categories.set(categoryName, category.id);
    }

    let inserted = 0;
    let updated = 0;
    let descriptionsBlanked = 0;
    let customDescriptionsPreserved = 0;
    for (const [index, row] of rows.entries()) {
      const sizeNumber = parseSizeNumber(row.sizeNominal);
      const size = await one(sql,
        'insert into kublai_size (id, "organizationId", nominal, "unitId", "createdAt") values ($1, $2, $3, $4, $5) ' +
          'on conflict ("organizationId", nominal, "unitId") do update set nominal = excluded.nominal returning id',
        [randomUUID(), organizationId, String(sizeNumber), unit.id, new Date()],
      );
      const existing = byCode.get(row.sourceCode) || byName.get(normalizeKey(row.displayName));
      const partId = existing ? existing.id : randomUUID();
      const description = existing && !likelyGeneratedDescription(existing.description, row) ? normalize(existing.description) : "";
      if (existing && existing.description && !description) descriptionsBlanked += 1;
      if (description) customDescriptionsPreserved += 1;

      if (existing) {
        await sql.unsafe(
          'update kublai_part_definition set "catalogId" = $1, "categoryId" = $2, "displayName" = $3, description = $4, "imageUrl" = null, "sizeLabel" = $5, "materialId" = $6, "sizeId" = $7, "isActive" = true where id = $8',
          [catalog.id, categories.get(row.category), row.displayName, description, row.sizeLabel, material.id, size.id, partId],
        );
        updated += 1;
      } else {
        await sql.unsafe(
          'insert into kublai_part_definition (id, "organizationId", "catalogId", "categoryId", "displayName", description, "imageUrl", "sizeLabel", "materialId", "sizeId", "isActive", "createdAt") values ($1, $2, $3, $4, $5, $6, null, $7, $8, $9, true, $10)',
          [partId, organizationId, catalog.id, categories.get(row.category), row.displayName, description, row.sizeLabel, material.id, size.id, new Date()],
        );
        inserted += 1;
      }

      await sql.unsafe('delete from kublai_part_synonym where "partDefinitionId" = $1', [partId]);
      const aliases = [...new Set([...(row.aliases || []), ...(existing && existing.description && likelyGeneratedDescription(existing.description, row) ? [existing.description] : []), sourceCodeAlias(row.sourceCode)].map(normalize).filter(Boolean))];
      for (const synonym of aliases) {
        await sql.unsafe('insert into kublai_part_synonym (id, "partDefinitionId", synonym) values ($1, $2, $3)', [randomUUID(), partId, synonym]);
      }
    }

    console.log(JSON.stringify({
      ok: true,
      apply,
      sourcePath,
      rows: rows.length,
      validation,
      summary: {
        mode: "apply",
        organizationId,
        backupPath,
        sourceRows: rows.length,
        existingBds: existingBds.length,
        inserted,
        updated,
        descriptionsBlanked,
        customDescriptionsPreserved,
      },
    }, null, 2));
  } catch (error) {
    throw error;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
