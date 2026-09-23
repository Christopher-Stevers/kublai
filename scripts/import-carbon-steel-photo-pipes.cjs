#!/usr/bin/env node
// @ts-nocheck
require("dotenv/config");

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const postgres = require("postgres");
const XLSX = require("xlsx");

const EXCEL_PATH =
  process.argv.find((arg) => arg.endsWith(".xlsx")) ||
  path.join(
    process.cwd(),
    "exports/foremenhq-carbon-steel-pipe-photo-candidates-clean-display-names-2026-06-26.xlsx",
  );
const TIM_EMAIL = process.env.PIPE_IMPORT_USER_EMAIL || "tim.j.saunders@gmail.com";
const APPLY = process.argv.includes("--apply");

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return normalize(value).toLowerCase();
}

function optional(value) {
  const text = normalize(value);
  return text ? text : null;
}

function parseSize(value) {
  const text = normalize(value).replace(/[”″"]/g, "");
  const mixed =
    /^(\d+)\s+([0-9]+)\/([0-9]+)$/.exec(text) ||
    /^(\d+)-([0-9]+)\/([0-9]+)$/.exec(text);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^([0-9]+)\/([0-9]+)$/.exec(text);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function decimalToFraction(num) {
  if (Number.isInteger(num)) return String(num);
  const whole = Math.floor(Math.abs(num));
  const fractional = Math.abs(num) - whole;
  const sixteenths = Math.round(fractional * 16);
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(sixteenths, 16);
  return `${num < 0 ? "-" : ""}${whole > 0 ? `${whole} ` : ""}${sixteenths / divisor}/${16 / divisor}`;
}

function sizeLabel(value) {
  const parsed = parseSize(value);
  return `${parsed == null ? normalize(value) : decimalToFraction(parsed)}"`;
}

function aliasesFor(row) {
  const values = [
    row.aliases,
    row.sourceSku,
    row.description,
    row.displayName,
    "Black steel pipe",
    "A53",
    "ERW",
  ];
  const out = [];
  const seen = new Set();

  for (const value of values) {
    for (const piece of String(value ?? "").split(/[;,\n]/)) {
      const alias = normalize(piece).slice(0, 255);
      const key = normalizeKey(alias);
      if (!alias || seen.has(key)) continue;
      seen.add(key);
      out.push(alias);
    }
  }

  return out;
}

async function ensureNamed(tx, tableName, organizationId, name, extra = {}) {
  const [existing] = await tx`
    select id, name
    from ${tx(tableName)}
    where "organizationId" = ${organizationId}
      and lower(name) = lower(${name})
    limit 1
  `;
  if (existing) return existing;

  const values = { id: randomUUID(), organizationId, name, ...extra };
  const [created] = await tx`
    insert into ${tx(tableName)} ${tx([values], Object.keys(values))}
    returning id, name
  `;
  return created;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!fs.existsSync(EXCEL_PATH)) throw new Error(`Missing workbook: ${EXCEL_PATH}`);

  const workbook = XLSX.readFile(EXCEL_PATH);
  const sheet = workbook.Sheets.Parts;
  if (!sheet) throw new Error("Workbook missing Parts sheet");

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" }).map((row, index) => ({
    rowNumber: row.rowNumber || index + 1,
    catalog: normalize(row.catalog || "Plumbing"),
    category: normalize(row.category || "Pipe"),
    material: normalize(row.material || "Carbon Steel"),
    displayName: normalize(row.displayName),
    description: normalize(row.description || row.displayName),
    sizeNominal: normalize(row.sizeNominal),
    sizeUnit: normalize(row.sizeUnit || "in"),
    imageUrl: optional(row.imageUrl),
    aliases: row.aliases,
    isActive: String(row.isActive || "true").toLowerCase() !== "false",
    sourceSku: normalize(row.sourceSku),
  }));

  if (rows.length !== 28) throw new Error(`Expected 28 rows, found ${rows.length}`);
  for (const row of rows) {
    if (!row.catalog || !row.category || !row.material || !row.displayName) {
      throw new Error(`Bad row ${row.rowNumber}`);
    }
    if (parseSize(row.sizeNominal) == null) {
      throw new Error(`Bad size in row ${row.rowNumber}: ${row.sizeNominal}`);
    }
  }

  const duplicateNames = rows
    .map((row) => normalizeKey(row.displayName))
    .filter((value, index, all) => all.indexOf(value) !== index);
  if (duplicateNames.length) {
    throw new Error(`Duplicate displayNames in workbook: ${duplicateNames.join(", ")}`);
  }

  const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
  });

  try {
    const result = await sql.begin(async (tx) => {
      const [user] = await tx`
        select id, email, "organizationId"
        from kublai_user
        where lower(email) = lower(${TIM_EMAIL})
        limit 1
      `;
      if (!user?.organizationId) throw new Error(`No organization found for ${TIM_EMAIL}`);
      const organizationId = user.organizationId;

      const existingByName = await tx`
        select pd.id, pd."displayName", pd.description, m.name as "materialName", c.name as "categoryName"
        from kublai_part_definition pd
        left join kublai_material m on m.id = pd."materialId"
        left join kublai_category c on c.id = pd."categoryId"
        where pd."organizationId" = ${organizationId}
          and lower(pd."displayName") in ${tx(rows.map((row) => normalizeKey(row.displayName)))}
      `;
      const existingCarbonSteelPipe = await tx`
        select pd.*, m.name as "materialName", c.name as "categoryName"
        from kublai_part_definition pd
        left join kublai_material m on m.id = pd."materialId"
        left join kublai_category c on c.id = pd."categoryId"
        where pd."organizationId" = ${organizationId}
          and lower(coalesce(m.name, '')) = 'carbon steel'
          and lower(coalesce(c.name, '')) = 'pipe'
      `;
      const existingIds = [...new Set([...existingByName, ...existingCarbonSteelPipe].map((row) => row.id))];
      const existingAliases = existingIds.length
        ? await tx`
            select ps.*
            from kublai_part_synonym ps
            where ps."partDefinitionId" in ${tx(existingIds)}
          `
        : [];

      const backupPath = path.join(
        process.cwd(),
        "state-backups",
        `carbon-steel-photo-pipe-import-backup-${Date.now()}.json`,
      );
      const backup = {
        createdAt: new Date().toISOString(),
        excelPath: EXCEL_PATH,
        user,
        rows,
        existingByName,
        existingCarbonSteelPipe,
        existingAliases,
      };

      const catalog = await ensureNamed(tx, "kublai_catalog", organizationId, "Plumbing", {
        sortOrder: 0,
        createdAt: new Date(),
      });
      const category = await ensureNamed(tx, "kublai_category", organizationId, "Pipe", {
        sortOrder: 0,
      });
      const material = await ensureNamed(tx, "kublai_material", organizationId, "Carbon Steel", {
        createdAt: new Date(),
      });
      const [inchUnit] = await tx`
        select id, code
        from kublai_unit
        where lower(code) in ('in', 'inch')
        order by case when lower(code) = 'in' then 0 else 1 end
        limit 1
      `;
      if (!inchUnit) throw new Error("No inch unit found");

      if (!APPLY) {
        return {
          ok: true,
          dryRun: true,
          rows: rows.length,
          wouldInsert: rows.length - existingByName.length,
          wouldUpdate: existingByName.length,
          matchedExistingNames: existingByName.length,
        };
      }

      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));

      let inserted = 0;
      let updated = 0;
      let synonyms = 0;

      for (const row of rows) {
        const parsedSize = parseSize(row.sizeNominal);
        const [size] = await tx`
          insert into kublai_size (id, "organizationId", nominal, "unitId", "createdAt")
          values (${randomUUID()}, ${organizationId}, ${String(parsedSize)}, ${inchUnit.id}, ${new Date()})
          on conflict ("organizationId", nominal, "unitId") do update set nominal = excluded.nominal
          returning id
        `;
        const [existing] = await tx`
          select id
          from kublai_part_definition
          where "organizationId" = ${organizationId}
            and lower("displayName") = lower(${row.displayName})
          limit 1
        `;
        const partId = existing?.id || randomUUID();
        const sortOrder = Number(row.rowNumber) || 0;

        if (existing) {
          await tx`
            update kublai_part_definition
            set "catalogId" = ${catalog.id}, "categoryId" = ${category.id}, "displayName" = ${row.displayName},
                description = ${row.description || null}, "imageUrl" = ${row.imageUrl}, "sizeLabel" = ${sizeLabel(row.sizeNominal)},
                "materialId" = ${material.id}, "sizeId" = ${size.id}, "sortOrder" = ${sortOrder}, "isActive" = ${row.isActive}
            where id = ${partId}
          `;
          updated += 1;
        } else {
          await tx`
            insert into kublai_part_definition (
              id, "organizationId", "catalogId", "categoryId", "displayName", description, "imageUrl",
              "sizeLabel", "materialId", "sizeId", "sortOrder", "isActive", "createdAt"
            )
            values (
              ${partId}, ${organizationId}, ${catalog.id}, ${category.id}, ${row.displayName}, ${row.description || null},
              ${row.imageUrl}, ${sizeLabel(row.sizeNominal)}, ${material.id}, ${size.id}, ${sortOrder}, ${row.isActive}, ${new Date()}
            )
          `;
          inserted += 1;
        }

        await tx`delete from kublai_part_synonym where "partDefinitionId" = ${partId}`;
        const aliases = aliasesFor(row);
        if (aliases.length) {
          await tx`insert into kublai_part_synonym ${tx(
            aliases.map((synonym) => ({ id: randomUUID(), partDefinitionId: partId, synonym })),
            ["id", "partDefinitionId", "synonym"],
          )}`;
          synonyms += aliases.length;
        }
      }

      return { ok: true, backupPath, rows: rows.length, inserted, updated, synonyms };
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
