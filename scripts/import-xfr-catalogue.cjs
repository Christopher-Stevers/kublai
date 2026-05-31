#!/usr/bin/env node
// @ts-nocheck
require("dotenv/config");

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const postgres = require("postgres");

const DEFAULT_SOURCE = path.join(
  process.cwd(),
  "data/catalogue/xfr-catalogue.json",
);
const TIM_EMAIL =
  process.env.XFR_IMPORT_USER_EMAIL || "tim.j.saunders@gmail.com";
const VALID_CATALOG = "Plumbing";
const VALID_CATEGORIES = new Set(["Pipe", "Fitting"]);
const VALID_MATERIAL = "XFR";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const validateOnly = args.has("--validate-only");
const sourceArg = process.argv.find((arg) => arg.startsWith("--source="));
const categoryArg = process.argv.find((arg) => arg.startsWith("--category="));
const sourcePath = sourceArg
  ? path.resolve(sourceArg.slice("--source=".length))
  : DEFAULT_SOURCE;
const categoryFilter = categoryArg
  ? normalize(categoryArg.slice("--category=".length))
  : null;

function normalize(value) {
  return String(value ?? "").trim();
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
    .map((part) =>
      part
        .replace(/[”″"]/g, "")
        .replace(/\s*(?:inches|inch|in)\s*$/i, "")
        .trim(),
    )
    .filter(Boolean)
    .map((part) => {
      const parsed = parseSizeNumber(part);
      return `${parsed == null ? part : decimalToFraction(parsed)}${suffix}`;
    })
    .join(" x ");
}

function buildDisplayName(row) {
  return [
    formatSizeLabel(row.sizeNominal, row.sizeUnit),
    VALID_MATERIAL,
    displayPartLabel(row),
  ]
    .filter(Boolean)
    .join(" ");
}

function displayPartLabel(row) {
  return normalize(row.description).replace(/\s+Elbow$/i, "");
}

function collectValidation(data) {
  const errors = [];
  const warnings = [];
  const keys = new Map();
  const evidenceByPath = new Map(
    (data.imageEvidence ?? [])
      .filter((item) => item.localImagePath)
      .map((item) => [item.localImagePath, item]),
  );

  for (const [index, row] of (data.rows ?? []).entries()) {
    const label = `row ${index + 1} (${row.displayName || row.description || "unnamed"})`;
    if (row.catalog !== VALID_CATALOG)
      errors.push(`${label}: catalog must be ${VALID_CATALOG}`);
    if (!VALID_CATEGORIES.has(row.category))
      errors.push(`${label}: category must be Pipe or Fitting`);
    if (row.material !== VALID_MATERIAL)
      errors.push(`${label}: material must be ${VALID_MATERIAL}`);
    const expectedDescription = displayPartLabel(row);
    if (normalize(row.description) !== expectedDescription)
      errors.push(`${label}: description should be "${expectedDescription}"`);
    if (!normalize(row.sizeNominal))
      errors.push(`${label}: sizeNominal is required`);
    if (!normalize(row.description))
      errors.push(`${label}: description is required`);
    if (
      !Array.isArray(row.manufacturerSources) ||
      row.manufacturerSources.length === 0
    ) {
      errors.push(`${label}: no manufacturer source confirms this part exists`);
    }
    const expectedName = buildDisplayName(row);
    if (row.displayName !== expectedName)
      errors.push(`${label}: displayName should be "${expectedName}"`);
    const duplicateKey = [
      row.category,
      row.material,
      normalizeKey(row.sizeNominal),
      normalizeKey(row.description),
    ].join("|");
    if (keys.has(duplicateKey))
      errors.push(`${label}: duplicates ${keys.get(duplicateKey)}`);
    keys.set(duplicateKey, label);

    const imageUrl = normalize(row.imageUrl);
    if (imageUrl) {
      const evidence =
        evidenceByPath.get(imageUrl) ||
        evidenceByPath.get(imageUrl.replace(/^\/images\//, "public/images/"));
      if (!evidence)
        errors.push(`${label}: imageUrl has no imageEvidence entry`);
      const imageText = [imageUrl, evidence?.notes, evidence?.whyItMatches]
        .join(" ")
        .toLowerCase();
      if (/white pvc|black abs|copper|brass|blue|green/.test(imageText)) {
        errors.push(
          `${label}: image evidence marks an obviously wrong material/color`,
        );
      }
    } else {
      warnings.push(
        `${label}: imageUrl blank until a verified XFR image is available`,
      );
    }
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
  if (!fs.existsSync(sourcePath))
    throw new Error(`Source file not found: ${sourcePath}`);
  const data = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  if (categoryFilter && !VALID_CATEGORIES.has(categoryFilter)) {
    throw new Error(
      `Invalid --category=${categoryFilter}; expected Pipe or Fitting`,
    );
  }
  const rows = categoryFilter
    ? data.rows.filter((row) => row.category === categoryFilter)
    : data.rows;
  const validation = collectValidation({ ...data, rows });
  if (validation.errors.length) {
    console.error(
      JSON.stringify({ ok: false, apply, sourcePath, validation }, null, 2),
    );
    process.exit(1);
  }
  if (validateOnly || !process.env.DATABASE_URL) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          apply,
          sourcePath,
          categoryFilter,
          sourceRows: data.rows.length,
          rows: rows.length,
          validation,
          database: validateOnly
            ? "skipped: --validate-only"
            : "skipped: DATABASE_URL is not set",
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
      if (!user?.organizationId)
        throw new Error(`No organization found for ${TIM_EMAIL}`);
      const organizationId = user.organizationId;
      const existingXfr = await tx`
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
        backupPath = path.join(
          backupDir,
          `xfr-catalogue-backup-${Date.now()}.json`,
        );
        fs.writeFileSync(
          backupPath,
          JSON.stringify(
            { createdAt: new Date().toISOString(), sourcePath, existingXfr },
            null,
            2,
          ),
        );
      }

      if (!apply)
        return {
          mode: "dry-run",
          organizationId,
          backupPath,
          categoryFilter,
          sourceRows: data.rows.length,
          wouldUpsert: rows.length,
          existingXfr: existingXfr.length,
        };

      const catalog = await ensureNamed(
        tx,
        "kublai_catalog",
        organizationId,
        VALID_CATALOG,
        { sortOrder: 0, createdAt: new Date() },
      );
      const material = await ensureNamed(
        tx,
        "kublai_material",
        organizationId,
        VALID_MATERIAL,
        { createdAt: new Date() },
      );
      const [unit] =
        await tx`select id from kublai_unit where lower(code) in ('in', 'inch') order by code limit 1`;
      if (!unit) throw new Error("No inch unit found");

      let upserted = 0;
      const categoryIds = new Map();
      for (const categoryName of [
        ...new Set(rows.map((row) => row.category)),
      ]) {
        const category = await ensureNamed(
          tx,
          "kublai_category",
          organizationId,
          categoryName,
          { sortOrder: categoryName === "Pipe" ? 0 : 1 },
        );
        categoryIds.set(categoryName, category.id);
      }

      for (const row of rows) {
        const sizeNumber = parseSizeNumber(row.sizeNominal);
        if (sizeNumber == null)
          throw new Error(`Cannot parse sizeNominal for ${row.displayName}`);
        const sizeText = String(sizeNumber);
        const [size] = await tx`
          insert into kublai_size (id, "organizationId", nominal, "unitId", "createdAt")
          values (${randomUUID()}, ${organizationId}, ${sizeText}, ${unit.id}, ${new Date()})
          on conflict ("organizationId", nominal, "unitId") do update set nominal = excluded.nominal
          returning id`;
        const categoryId = categoryIds.get(row.category);
        const existing = existingXfr.find(
          (part) =>
            normalizeKey(part.displayName) === normalizeKey(row.displayName),
        );
        const partId = existing?.id ?? randomUUID();
        if (existing) {
          await tx`
            update kublai_part_definition
            set "catalogId" = ${catalog.id}, "categoryId" = ${categoryId}, "displayName" = ${row.displayName},
                description = ${normalize(row.description)}, "imageUrl" = ${normalize(row.imageUrl) || null}, "sizeLabel" = ${formatSizeLabel(row.sizeNominal, row.sizeUnit)},
                "materialId" = ${material.id}, "sizeId" = ${size.id}, "isActive" = true
            where id = ${partId}`;
        } else {
          await tx`
            insert into kublai_part_definition (id, "organizationId", "catalogId", "categoryId", "displayName", description, "imageUrl", "sizeLabel", "materialId", "sizeId", "isActive", "createdAt")
            values (${partId}, ${organizationId}, ${catalog.id}, ${categoryId}, ${row.displayName}, ${normalize(row.description)}, ${normalize(row.imageUrl) || null}, ${formatSizeLabel(row.sizeNominal, row.sizeUnit)}, ${material.id}, ${size.id}, true, ${new Date()})`;
        }
        await tx`delete from kublai_part_synonym where "partDefinitionId" = ${partId}`;
        const aliases = [
          ...new Set((row.aliases ?? []).map(normalize).filter(Boolean)),
        ];
        for (const synonym of aliases) {
          await tx`insert into kublai_part_synonym (id, "partDefinitionId", synonym) values (${randomUUID()}, ${partId}, ${synonym})`;
        }
        upserted += 1;
      }
      return {
        mode: "apply",
        organizationId,
        backupPath,
        upserted,
        existingXfr: existingXfr.length,
      };
    });
    console.log(
      JSON.stringify(
        {
        ok: true,
        apply,
        sourcePath,
          categoryFilter,
          sourceRows: data.rows.length,
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
