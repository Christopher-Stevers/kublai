#!/usr/bin/env node
// @ts-nocheck
require("dotenv/config");

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const postgres = require("postgres");

const TIM_EMAIL = process.env.PIPE_IMPORT_USER_EMAIL || "tim.j.saunders@gmail.com";
const apply = process.argv.includes("--apply");

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
  return `${num < 0 ? "-" : ""}${whole > 0 ? `${whole} ` : ""}${sixteenths / divisor}/${16 / divisor}`;
}

function sizeLabel(sizeNominal) {
  return normalize(sizeNominal)
    .split(/\s*(?:x|×)\s*/i)
    .map((part) => {
      const parsed = parseSizeNumber(part);
      return `${parsed == null ? part.replace(/-/g, " ") : decimalToFraction(parsed)}"`;
    })
    .join(" x ");
}

function pipeRow({ material, size, description, aliases = [], sources, sourceCode, sourcePage, sourceUrl }) {
  const label = sizeLabel(size);
  return {
    catalog: "Plumbing",
    category: "Pipe",
    material,
    sizeNominal: size,
    sizeUnit: "in",
    sizeLabel: label,
    displayName: `${label} ${material} ${description}`,
    description,
    imageUrl: "",
    aliases: [...new Set([material, `${material} Pipe`, ...aliases, sourceCode].filter(Boolean))],
    manufacturerSources: sources,
    supplierParts: [],
    sourceCode,
    sourcePage,
    sourceUrl,
  };
}

const ipexCatalogueUrl =
  "https://ipexna.com/wp-content/uploads/2026/04/catalogue-caen-ipex-plumbing-mechanical-systems.pdf";
const bibbyCatalogueUrl =
  "https://bibby-ste-croix.com/upl/downloads/catalog/products/cast-iron-soil-pipe-and-fittings-for-drain-waste-vent-315c16a1.pdf";

const rows = [
  ...["1-1/4", "1-1/2", "2", "3", "4", "6"].map((size) =>
    pipeRow({
      material: "ABS",
      size,
      description: "Solid Wall Pipe 12 ft",
      aliases: ["IPEX Drain-Way ABS DWV", "ABS DWV Solid Wall Pipe"],
      sources: ["ipexPlumbingMechanicalCatalogue2026AbsDwv"],
      sourcePage: 27,
      sourceUrl: ipexCatalogueUrl,
    }),
  ),
  ...["1-1/2", "2", "3", "4", "6"].map((size) =>
    pipeRow({
      material: "ABS",
      size,
      description: "Cell Core Pipe 12 ft",
      aliases: ["IPEX Drain-Way ABS DWV", "ABS DWV Cell Core Pipe"],
      sources: ["ipexPlumbingMechanicalCatalogue2026AbsDwv"],
      sourcePage: 27,
      sourceUrl: ipexCatalogueUrl,
    }),
  ),
  ...[
    ["1-1/2", "010001"],
    ["2", "010002"],
    ["3", "010003"],
    ["4", "010004"],
    ["6", "010006"],
    ["8", "010087"],
    ["10", "010088"],
    ["12", "010089"],
  ].map(([size, sourceCode]) =>
    pipeRow({
      material: "PVC DWV",
      size,
      description: "System 15 Pipe Plain End 12 ft",
      aliases: ["IPEX System 15", "System 15 DWV Pipe", sourceCode],
      sources: ["ipexPlumbingMechanicalCatalogue2026System15Dwv"],
      sourceCode,
      sourcePage: 44,
      sourceUrl: ipexCatalogueUrl,
    }),
  ),
  ...[
    ["4", "010005"],
    ["6", "010046"],
    ["8", "010008"],
    ["10", "010010"],
    ["12", "010012"],
    ["14", "010031"],
    ["16", "010032"],
    ["18", "010034"],
    ["20", "010035"],
    ["24", "010036"],
  ].map(([size, sourceCode]) =>
    pipeRow({
      material: "PVC DWV",
      size,
      description: "System 15 Pipe Bell End 20 ft",
      aliases: ["IPEX System 15", "System 15 DWV Pipe", sourceCode],
      sources: ["ipexPlumbingMechanicalCatalogue2026System15Dwv"],
      sourceCode,
      sourcePage: 44,
      sourceUrl: ipexCatalogueUrl,
    }),
  ),
  ...[
    ["2", "s12050"],
    ["3", "s13050"],
    ["4", "s14050"],
    ["6", "s16050"],
    ["8", "s18050"],
    ["10", "s10050"],
  ].map(([size, sourceCode]) =>
    pipeRow({
      material: "Cast",
      size,
      description: "Hubless Pipe 5 ft",
      aliases: ["Bibby-Ste-Croix cast iron", "MJ Hubless Pipe", sourceCode],
      sources: ["bibbySteCroixCastIronSoilPipeAndFittingsDwv"],
      sourceCode,
      sourcePage: 44,
      sourceUrl: bibbyCatalogueUrl,
    }),
  ),
  ...[
    ["2", "s12860"],
    ["3", "s13860"],
    ["4", "s14860"],
  ].map(([size, sourceCode]) =>
    pipeRow({
      material: "Cast",
      size,
      description: "Hubless Pipe 8.5 ft",
      aliases: ["Bibby-Ste-Croix cast iron", "MJ Hubless Pipe", sourceCode],
      sources: ["bibbySteCroixCastIronSoilPipeAndFittingsDwv"],
      sourceCode,
      sourcePage: 44,
      sourceUrl: bibbyCatalogueUrl,
    }),
  ),
  ...[
    ["1-1/2", "s11500"],
    ["2", "s12100"],
    ["3", "s13100"],
    ["4", "s14100"],
    ["5", "s15100"],
    ["6", "s16100"],
    ["8", "s18100"],
    ["10", "s10100"],
    ["12", "s17120"],
    ["15", "s17150"],
  ].map(([size, sourceCode]) =>
    pipeRow({
      material: "Cast",
      size,
      description: "Hubless Pipe 10 ft",
      aliases: ["Bibby-Ste-Croix cast iron", "MJ Hubless Pipe", sourceCode],
      sources: ["bibbySteCroixCastIronSoilPipeAndFittingsDwv"],
      sourceCode,
      sourcePage: 44,
      sourceUrl: bibbyCatalogueUrl,
    }),
  ),
];

const xfrPath = path.join(process.cwd(), "data/catalogue/xfr-catalogue.json");
if (fs.existsSync(xfrPath)) {
  const xfr = JSON.parse(fs.readFileSync(xfrPath, "utf8"));
  rows.push(...(xfr.rows ?? []).filter((row) => row.category === "Pipe"));
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
  const duplicate = new Set();
  for (const row of rows) {
    const key = [row.material, row.category, row.displayName].map(normalizeKey).join("|");
    if (duplicate.has(key)) throw new Error(`Duplicate generated pipe row: ${row.displayName}`);
    duplicate.add(key);
    if (parseSizeNumber(row.sizeNominal) == null) throw new Error(`Bad size: ${row.displayName}`);
  }

  if (!apply || !process.env.DATABASE_URL) {
    console.log(JSON.stringify({ ok: true, apply, rows: rows.length, database: "skipped" }, null, 2));
    return;
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10, idle_timeout: 5 });
  try {
    const [user] =
      await sql`select id, email, "organizationId" from kublai_user where lower(email) = lower(${TIM_EMAIL}) limit 1`;
    if (!user?.organizationId) throw new Error(`No organization found for ${TIM_EMAIL}`);
    const organizationId = user.organizationId;

    const backupDir = path.join(process.cwd(), "state-backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const before = await sql`
      select pd.*, m.name as "materialName", c.name as "categoryName"
      from kublai_part_definition pd
      left join kublai_material m on m.id = pd."materialId"
      left join kublai_category c on c.id = pd."categoryId"
      where pd."organizationId" = ${organizationId}
        and c.name = 'Pipe'
        and m.name in ('ABS', 'PVC DWV', 'Cast', 'XFR')`;
    const backupPath = path.join(backupDir, `missing-pipe-import-backup-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), rows, before }, null, 2));

    const catalog = await ensureNamed(sql, "kublai_catalog", organizationId, "Plumbing", {
      sortOrder: 0,
      createdAt: new Date(),
    });
    const category = await ensureNamed(sql, "kublai_category", organizationId, "Pipe", { sortOrder: 0 });
    const units = await sql`select id, code from kublai_unit where lower(code) in ('in', 'inch') order by code`;
    const inchUnit = units.find((unit) => ["in", "inch"].includes(normalizeKey(unit.code)));
    if (!inchUnit) throw new Error("No inch unit found");

    const materialCache = new Map();
    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      let material = materialCache.get(row.material);
      if (!material) {
        material = await ensureNamed(sql, "kublai_material", organizationId, row.material, { createdAt: new Date() });
        materialCache.set(row.material, material);
      }

      const sizeNumber = parseSizeNumber(row.sizeNominal);
      const [size] = await sql`
        insert into kublai_size (id, "organizationId", nominal, "unitId", "createdAt")
        values (${randomUUID()}, ${organizationId}, ${String(sizeNumber)}, ${inchUnit.id}, ${new Date()})
        on conflict ("organizationId", nominal, "unitId") do update set nominal = excluded.nominal
        returning id`;

      const [existing] = await sql`
        select pd.id
        from kublai_part_definition pd
        where pd."organizationId" = ${organizationId}
          and lower(pd."displayName") = lower(${row.displayName})
        limit 1`;
      const partId = existing?.id ?? randomUUID();
      if (existing) {
        await sql`
          update kublai_part_definition
          set "catalogId" = ${catalog.id}, "categoryId" = ${category.id}, "displayName" = ${row.displayName},
              description = ${normalize(row.description)}, "imageUrl" = ${normalize(row.imageUrl) || null},
              "sizeLabel" = ${normalize(row.sizeLabel) || sizeLabel(row.sizeNominal)}, "materialId" = ${material.id},
              "sizeId" = ${size.id}, "isActive" = true
          where id = ${partId}`;
        updated += 1;
      } else {
        await sql`
          insert into kublai_part_definition (id, "organizationId", "catalogId", "categoryId", "displayName", description, "imageUrl", "sizeLabel", "materialId", "sizeId", "isActive", "createdAt")
          values (${partId}, ${organizationId}, ${catalog.id}, ${category.id}, ${row.displayName}, ${normalize(row.description)}, ${normalize(row.imageUrl) || null}, ${normalize(row.sizeLabel) || sizeLabel(row.sizeNominal)}, ${material.id}, ${size.id}, true, ${new Date()})`;
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
    }

    console.log(JSON.stringify({ ok: true, backupPath, rows: rows.length, inserted, updated }, null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
