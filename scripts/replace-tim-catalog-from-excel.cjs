#!/usr/bin/env node
// @ts-nocheck
require('dotenv/config');

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const postgres = require('postgres');
const XLSX = require('xlsx');

const EXCEL_PATH = process.argv[2] || '/home/halvor/.openclaw/workspace/foremenhq-supplier-catalog-review.xlsx';
const TIM_EMAIL = 'tim.j.saunders@gmail.com';
const SUPPLIER_NAME = 'Next';
const CHUNK_SIZE = 500;

function required(value, label) {
  if (value == null || String(value).trim() === '') throw new Error(`Missing ${label}`);
  return String(value).trim();
}

function optionalString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function parseNumber(value) {
  if (value == null || value === '') return null;
  const firstDimension = String(value).trim().split(/\s*(?:x|×)\s*/i)[0] ?? '';
  const number = Number(firstDimension);
  if (!Number.isFinite(number)) return null;
  return number;
}

function decimalToFraction(num) {
  if (Number.isInteger(num)) return String(num);
  const whole = Math.floor(Math.abs(num));
  const fractional = Math.abs(num) - whole;
  const sixteenths = Math.round(fractional * 16);
  if (sixteenths === 0) return String(num < 0 ? -whole : whole);
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(sixteenths, 16);
  const fraction = `${sixteenths / divisor}/${16 / divisor}`;
  return `${num < 0 ? '-' : ''}${whole > 0 ? `${whole} ` : ''}${fraction}`;
}

function parseSizeInput(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(text) || /^(\d+)-(\d+)\/(\d+)$/.exec(text);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^(\d+)\/(\d+)$/.exec(text);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function formatSizeDimensions(sizeNominal, sizeUnit) {
  if (sizeNominal == null || sizeNominal === '') return '';
  const unit = String(sizeUnit ?? '').trim();
  const unitSuffix = ['in', 'inch', 'inches', '"'].includes(unit.toLowerCase()) ? '"' : unit ? ` ${unit}` : '';
  return String(sizeNominal)
    .trim()
    .split(/\s*(?:x|×)\s*/i)
    .map((part) => part.trim().replace(/[”″"]/g, '').replace(/\s*(inches|inch|in)\s*$/i, '').trim())
    .filter(Boolean)
    .map((part) => {
      const parsed = parseSizeInput(part);
      return `${parsed === null ? part : decimalToFraction(parsed)}${unitSuffix}`;
    })
    .join(' x ');
}

function generateDisplayName(row) {
  return [formatSizeDimensions(row.sizeNominalRaw, row.sizeUnit), row.material, row.description]
    .filter(Boolean)
    .join(' ')
    .trim();
}

function parseBoolean(value) {
  if (value == null || value === '') return true;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['false', '0', 'no', 'n'].includes(text)) return false;
  return true;
}

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

async function chunkedInsert(sql, tableName, rows, columns) {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    if (chunk.length) {
      await sql`insert into ${sql(tableName)} ${sql(chunk, columns)}`;
    }
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (!fs.existsSync(EXCEL_PATH)) throw new Error(`Excel file not found: ${EXCEL_PATH}`);

  const workbook = XLSX.readFile(EXCEL_PATH);
  const sheet = workbook.Sheets.Parts;
  if (!sheet) throw new Error('Workbook is missing Parts sheet');

  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  const rows = rawRows.map((row, index) => ({
    rowNumber: index + 2,
    catalog: required(row.catalog, `catalog at row ${index + 2}`),
    category: optionalString(row.category) || 'Fitting',
    material: optionalString(row.material),
    displayName: optionalString(row.displayName),
    description: optionalString(row.description),
    sizeNominalRaw: optionalString(row.sizeNominal),
    sizeLabel: null,
    sizeNominal: parseNumber(row.sizeNominal),
    sizeUnit: optionalString(row.sizeUnit),
    imageUrl: optionalString(row.imageUrl),
    aliases: optionalString(row.aliases),
    isActive: parseBoolean(row.isActive),
  }));

  for (const row of rows) {
    row.sizeLabel = formatSizeDimensions(row.sizeNominalRaw, row.sizeUnit) || null;
    row.displayName = row.displayName || generateDisplayName(row);
    if (!row.displayName) throw new Error(`Missing displayName and fallback fields at row ${row.rowNumber}`);
  }

  if (rows.length === 0) throw new Error('No rows found in workbook');

  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  const backupDir = path.join(process.cwd(), 'state-backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `catalog-replace-backup-${Date.now()}.json`);

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

      const [supplier] = await tx`
        select id, name, "organizationId"
        from kublai_supplier
        where lower(name) = lower(${SUPPLIER_NAME})
          and "organizationId" = ${organizationId}
        limit 1
      `;
      if (!supplier) throw new Error(`Supplier ${SUPPLIER_NAME} not found in Tim's organization`);

      const backup = {
        createdAt: new Date().toISOString(),
        excelPath: EXCEL_PATH,
        user,
        supplier,
        partDefinitions: await tx`select * from kublai_part_definition where "organizationId" = ${organizationId}`,
        supplierParts: await tx`select sp.* from kublai_supplier_part sp join kublai_part_definition pd on pd.id = sp."partDefinitionId" where pd."organizationId" = ${organizationId}`,
        partSynonyms: await tx`select ps.* from kublai_part_synonym ps join kublai_part_definition pd on pd.id = ps."partDefinitionId" where pd."organizationId" = ${organizationId}`,
        catalogs: await tx`select * from kublai_catalog where "organizationId" = ${organizationId}`,
        categories: await tx`select * from kublai_category where "organizationId" = ${organizationId}`,
        materials: await tx`select * from kublai_material where "organizationId" = ${organizationId}`,
        sizes: await tx`select * from kublai_size where "organizationId" = ${organizationId}`,
      };
      fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));

      const [before] = await tx`
        select
          count(*)::int as total,
          count(*) filter (where "isActive")::int as active
        from kublai_part_definition
        where "organizationId" = ${organizationId}
      `;

      await tx`
        update kublai_part_definition
        set "isActive" = false
        where "organizationId" = ${organizationId}
      `;

      const units = await tx`select id, code from kublai_unit`;
      const unitByCode = new Map(units.map((unit) => [normalizeKey(unit.code), unit]));
      const defaultUnit = unitByCode.get('ea') || units[0];
      if (!defaultUnit) throw new Error('No units exist in database');

      async function ensureByName(table, name, extra = {}) {
        const key = normalizeKey(name);
        const existing = await tx`select id, name from ${tx(table)} where "organizationId" = ${organizationId} and lower(name) = ${key} limit 1`;
        if (existing[0]) return existing[0];
        const values = { id: randomUUID(), organizationId, name, ...extra };
        const [created] = await tx`
          insert into ${tx(table)} ${tx([values], Object.keys(values))}
          returning id, name
        `;
        return created;
      }

      const catalogByName = new Map();
      const categoryByName = new Map();
      const materialByName = new Map();
      const sizeByKey = new Map();

      for (const name of [...new Set(rows.map((row) => row.catalog))]) {
        const catalog = await ensureByName('kublai_catalog', name, { sortOrder: 0, createdAt: new Date() });
        catalogByName.set(normalizeKey(name), catalog.id);
      }
      for (const name of [...new Set(rows.map((row) => row.category))]) {
        const category = await ensureByName('kublai_category', name, { sortOrder: name === 'Other' ? 9999 : 0 });
        categoryByName.set(normalizeKey(name), category.id);
      }
      for (const name of [...new Set(rows.map((row) => row.material).filter(Boolean))]) {
        const material = await ensureByName('kublai_material', name, { createdAt: new Date() });
        materialByName.set(normalizeKey(name), material.id);
      }

      async function ensureSize(sizeNominal, sizeUnitCode) {
        const nominal = sizeNominal == null ? 0 : sizeNominal;
        const unit = sizeUnitCode ? unitByCode.get(normalizeKey(sizeUnitCode)) : defaultUnit;
        const unitId = unit?.id || defaultUnit.id;
        const nominalText = String(nominal);
        const key = `${nominalText}|${unitId}`;
        if (sizeByKey.has(key)) return sizeByKey.get(key);
        const existing = await tx`
          select id from kublai_size
          where "organizationId" = ${organizationId}
            and nominal = ${nominalText}
            and "unitId" = ${unitId}
          limit 1
        `;
        if (existing[0]) {
          sizeByKey.set(key, existing[0].id);
          return existing[0].id;
        }
        const id = randomUUID();
        await tx`insert into kublai_size (id, "organizationId", nominal, "unitId", "createdAt") values (${id}, ${organizationId}, ${nominalText}, ${unitId}, ${new Date()})`;
        sizeByKey.set(key, id);
        return id;
      }

      const partRows = [];
      const supplierPartRows = [];
      const synonymRows = [];
      const now = new Date();

      for (const row of rows) {
        const partId = randomUUID();
        const sizeId = await ensureSize(row.sizeNominal, row.sizeUnit);
        partRows.push({
          id: partId,
          organizationId,
          catalogId: catalogByName.get(normalizeKey(row.catalog)),
          categoryId: categoryByName.get(normalizeKey(row.category)),
          displayName: row.displayName,
          description: row.description,
          imageUrl: row.imageUrl,
          sizeLabel: row.sizeLabel,
          materialId: row.material ? (materialByName.get(normalizeKey(row.material)) ?? null) : null,
          sizeId,
          isActive: row.isActive,
          createdAt: now,
        });
        supplierPartRows.push({
          id: randomUUID(),
          organizationId,
          supplierId: supplier.id,
          partDefinitionId: partId,
          supplierSku: null,
          supplierName: row.displayName,
          packSize: null,
          packUomId: null,
          lastKnownUnitCost: null,
          currency: 'CAD',
          isPreferred: true,
          notes: null,
          createdAt: now,
        });
        const aliases = (row.aliases || '')
          .split(/[;,\n]/)
          .map((alias) => alias.trim())
          .filter(Boolean);
        for (const synonym of [...new Set(aliases)]) {
          synonymRows.push({ id: randomUUID(), partDefinitionId: partId, synonym });
        }
      }

      await chunkedInsert(tx, 'kublai_part_definition', partRows, [
        'id', 'organizationId', 'catalogId', 'categoryId', 'displayName', 'description', 'imageUrl',
        'sizeLabel', 'materialId', 'sizeId', 'isActive', 'createdAt',
      ]);
      await chunkedInsert(tx, 'kublai_supplier_part', supplierPartRows, [
        'id', 'organizationId', 'supplierId', 'partDefinitionId', 'supplierSku', 'supplierName',
        'packSize', 'packUomId', 'lastKnownUnitCost', 'currency', 'isPreferred', 'notes', 'createdAt',
      ]);
      await chunkedInsert(tx, 'kublai_part_synonym', synonymRows, ['id', 'partDefinitionId', 'synonym']);

      const [after] = await tx`
        select
          count(*)::int as total,
          count(*) filter (where "isActive")::int as active
        from kublai_part_definition
        where "organizationId" = ${organizationId}
      `;
      const [newSupplierLinks] = await tx`
        select count(*)::int as count
        from kublai_supplier_part sp
        join kublai_part_definition pd on pd.id = sp."partDefinitionId"
        where pd."organizationId" = ${organizationId}
          and pd."isActive" = true
          and sp."supplierId" = ${supplier.id}
          and sp."isPreferred" = true
      `;

      return {
        organizationId,
        supplierId: supplier.id,
        backupPath,
        excelRows: rows.length,
        before,
        insertedParts: partRows.length,
        insertedSupplierParts: supplierPartRows.length,
        insertedSynonyms: synonymRows.length,
        after,
        activePreferredNextLinks: newSupplierLinks.count,
      };
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
