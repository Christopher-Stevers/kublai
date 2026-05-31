#!/usr/bin/env node
// @ts-nocheck
require("dotenv/config");

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const postgres = require("postgres");

const DEFAULT_SOURCE = path.join(process.cwd(), "data/catalogue/abs-catalogue.json");
const TIM_EMAIL = process.env.ABS_IMPORT_USER_EMAIL || "tim.j.saunders@gmail.com";
const VALID_CATALOG = "Plumbing";
const VALID_CATEGORY = "Fitting";
const VALID_MATERIAL = "ABS";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const validateOnly = args.has("--validate-only");
const sourceArg = process.argv.find((arg) => arg.startsWith("--source="));
const sourcePath = sourceArg ? path.resolve(sourceArg.slice("--source=".length)) : DEFAULT_SOURCE;

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

function formatSizeLabel(sizeNominal, sizeUnit) {
  const suffix = ["in", "inch", "inches", '"'].includes(normalizeKey(sizeUnit))
    ? '"'
    : normalize(sizeUnit)
      ? ` ${normalize(sizeUnit)}`
      : "";
  return normalize(sizeNominal)
    .split(/\s*(?:x|×)\s*/i)
    .map((part) => {
      const parsed = parseSizeNumber(part);
      return `${parsed == null ? part : decimalToFraction(parsed)}${suffix}`;
    })
    .join(" x ");
}

function buildDisplayName(row) {
  return [formatSizeLabel(row.sizeNominal, row.sizeUnit), VALID_MATERIAL, normalize(row.description)]
    .filter(Boolean)
    .join(" ");
}

function collectValidation(data) {
  const errors = [];
  const warnings = [];
  const keys = new Map();

  for (const [index, row] of (data.rows ?? []).entries()) {
    const label = `row ${index + 1} (${row.displayName || row.description || "unnamed"})`;
    if (row.catalog !== VALID_CATALOG) errors.push(`${label}: catalog must be ${VALID_CATALOG}`);
    if (row.category !== VALID_CATEGORY) errors.push(`${label}: category must be ${VALID_CATEGORY}`);
    if (row.material !== VALID_MATERIAL) errors.push(`${label}: material must be ${VALID_MATERIAL}`);
    if (!normalize(row.sizeNominal)) errors.push(`${label}: sizeNominal is required`);
    if (!normalize(row.description)) errors.push(`${label}: description is required`);
    if (!Array.isArray(row.manufacturerSources) || row.manufacturerSources.length === 0) {
      errors.push(`${label}: no manufacturer source confirms this part exists`);
    }
    const expectedName = buildDisplayName(row);
    if (row.displayName !== expectedName) {
      errors.push(`${label}: displayName should be "${expectedName}"`);
    }
    if (normalize(row.imageUrl)) {
      warnings.push(`${label}: imageUrl is set; verify it is ABS-specific before import`);
    }
    const duplicateKey = [
      row.category,
      row.material,
      normalizeKey(row.displayName),
    ].join("|");
    if (keys.has(duplicateKey)) errors.push(`${label}: duplicates ${keys.get(duplicateKey)}`);
    keys.set(duplicateKey, label);
  }

  return { errors, warnings };
}

async function ensureNamed(tx, table, organizationId, name, extra = {}) {
  const [existing] =
    await tx`select id, name from ${tx(table)} where "organizationId" = ${organizationId} and lower(name) = lower(${name}) limit 1`;
  if (existing) return existing;
  const values = { id: randomUUID(), organizationId, name, ...extra };
  const [created] =
    await tx`insert into ${tx(table)} ${tx([values], Object.keys(values))} returning id, name`;
  return created;
}

async function main() {
  if (!fs.existsSync(sourcePath)) throw new Error(`Source file not found: ${sourcePath}`);
  const data = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const rows = data.rows ?? [];
  const validation = collectValidation(data);
  if (validation.errors.length) {
    console.error(JSON.stringify({ ok: false, apply, sourcePath, validation }, null, 2));
    process.exit(1);
  }
  if (validateOnly || !process.env.DATABASE_URL) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          apply,
          sourcePath,
          rows: rows.length,
          validation,
          database: validateOnly ? "skipped: --validate-only" : "skipped: DATABASE_URL is not set",
        },
        null,
        2,
      ),
    );
    return;
  }

  const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
  });
  try {
    const summary = await sql.begin(async (tx) => {
      const [user] =
        await tx`select id, email, "organizationId" from kublai_user where lower(email) = lower(${TIM_EMAIL}) limit 1`;
      if (!user?.organizationId) throw new Error(`No organization found for ${TIM_EMAIL}`);
      const organizationId = user.organizationId;
      const existingAbs = await tx`
        select pd.*, c.name as "catalogName", cat.name as "categoryName", m.name as "materialName"
        from kublai_part_definition pd
        left join kublai_catalog c on c.id = pd."catalogId"
        left join kublai_category cat on cat.id = pd."categoryId"
        left join kublai_material m on m.id = pd."materialId"
        where pd."organizationId" = ${organizationId} and m.name = ${VALID_MATERIAL}`;
      let backupPath = null;
      if (apply) {
        const backupDir = path.join(process.cwd(), "state-backups");
        fs.mkdirSync(backupDir, { recursive: true });
        backupPath = path.join(backupDir, `abs-catalogue-backup-${Date.now()}.json`);
        fs.writeFileSync(
          backupPath,
          JSON.stringify({ createdAt: new Date().toISOString(), sourcePath, existingAbs }, null, 2),
        );
      }

      if (!apply) {
        return {
          mode: "dry-run",
          organizationId,
          backupPath,
          sourceRows: data.sourceSet?.sourceRows ?? null,
          wouldUpsert: rows.length,
          existingAbs: existingAbs.length,
        };
      }

      const catalog = await ensureNamed(tx, "kublai_catalog", organizationId, VALID_CATALOG, {
        sortOrder: 0,
        createdAt: new Date(),
      });
      const category = await ensureNamed(tx, "kublai_category", organizationId, VALID_CATEGORY, {
        sortOrder: 1,
      });
      const material = await ensureNamed(tx, "kublai_material", organizationId, VALID_MATERIAL, {
        createdAt: new Date(),
      });
      const [unit] =
        await tx`select id from kublai_unit where lower(code) in ('in', 'inch') order by code limit 1`;
      if (!unit) throw new Error("No inch unit found");

      let inserted = 0;
      let updated = 0;
      let processed = 0;
      console.error(`Starting ABS import for ${rows.length} rows`);
      for (const row of rows) {
        const sizeNumber = parseSizeNumber(row.sizeNominal);
        if (sizeNumber == null) throw new Error(`Cannot parse sizeNominal for ${row.displayName}`);
        const sizeText = String(sizeNumber);
        const [size] = await tx`
          insert into kublai_size (id, "organizationId", nominal, "unitId", "createdAt")
          values (${randomUUID()}, ${organizationId}, ${sizeText}, ${unit.id}, ${new Date()})
          on conflict ("organizationId", nominal, "unitId") do update set nominal = excluded.nominal
          returning id`;
        const existing = existingAbs.find(
          (part) => normalizeKey(part.displayName) === normalizeKey(row.displayName),
        );
        const partId = existing?.id ?? randomUUID();
        if (existing) {
          await tx`
            update kublai_part_definition
            set "catalogId" = ${catalog.id}, "categoryId" = ${category.id}, "displayName" = ${row.displayName},
                description = ${normalize(row.description)}, "imageUrl" = ${normalize(row.imageUrl) || null},
                "sizeLabel" = ${formatSizeLabel(row.sizeNominal, row.sizeUnit)}, "materialId" = ${material.id},
                "sizeId" = ${size.id}, "isActive" = true
            where id = ${partId}`;
          updated += 1;
        } else {
          await tx`
            insert into kublai_part_definition (id, "organizationId", "catalogId", "categoryId", "displayName", description, "imageUrl", "sizeLabel", "materialId", "sizeId", "isActive", "createdAt")
            values (${partId}, ${organizationId}, ${catalog.id}, ${category.id}, ${row.displayName}, ${normalize(row.description)}, ${normalize(row.imageUrl) || null}, ${formatSizeLabel(row.sizeNominal, row.sizeUnit)}, ${material.id}, ${size.id}, true, ${new Date()})`;
          inserted += 1;
        }
        await tx`delete from kublai_part_synonym where "partDefinitionId" = ${partId}`;
        const aliases = [...new Set((row.aliases ?? []).map(normalize).filter(Boolean))];
        for (const synonym of aliases) {
          await tx`insert into kublai_part_synonym (id, "partDefinitionId", synonym) values (${randomUUID()}, ${partId}, ${synonym})`;
        }
        processed += 1;
        if (processed % 25 === 0 || processed === rows.length) {
          console.error(`ABS import progress: ${processed}/${rows.length}`);
        }
      }
      return {
        mode: "apply",
        organizationId,
        backupPath,
        inserted,
        updated,
        upserted: inserted + updated,
        existingAbs: existingAbs.length,
      };
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          apply,
          sourcePath,
          rows: rows.length,
          validation,
          summary,
        },
        null,
        2,
      ),
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
