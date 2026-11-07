#!/usr/bin/env node
// @ts-nocheck
require('dotenv/config');
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const IMAGE_BASE = '/images/catalog/bds';
const WORKBOOK_PATH = '/mnt/c/Users/Halvo/OneDrive/Desktop/Catalogs/BDS.xlsx';

const imageForDescription = (description, category) => {
  const raw = String(description ?? '').trim();
  const text = raw
    .toLowerCase()
    .replace(/[”″]/g, '"')
    .replace(/½/g, '1/2')
    .replace(/[-–—]/g, '-')
    .replace(/\s+/g, ' ');

  // Tim asked for BDS fittings here. Leave pipe rows alone even though pipe images exist.
  if (String(category ?? '').toLowerCase() !== 'fitting') return null;

  if (!text) return null;
  if (text.includes('toilet flange')) return `${IMAGE_BASE}/bds-toilet-flange.webp`;
  if (text.includes('p-trap') || text.includes('p trap')) return `${IMAGE_BASE}/bds-p-trap.webp`;
  if (text.includes('cross')) return `${IMAGE_BASE}/bds-cross.webp`;
  if (text === 'ty' || text.includes('fitting ty')) return `${IMAGE_BASE}/bds-ty.webp`;
  if (text.includes('straight tee') || /\btee\b/.test(text)) return `${IMAGE_BASE}/bds-tee.webp`;
  if (text.includes('fitting wye')) return `${IMAGE_BASE}/bds-fitting-wye.webp`;
  if (/\bwye\b/.test(text)) return `${IMAGE_BASE}/bds-wye.webp`;
  if (text.includes('reducing coupling') || text.includes('reducer coupling')) return `${IMAGE_BASE}/bds-reducing-coupling.webp`;
  if (text.includes('coupling')) return `${IMAGE_BASE}/bds-coupling.webp`;
  if (text.includes('bushing')) return `${IMAGE_BASE}/bds-bushing.webp`;
  if (text.includes('22-1/2') || text.includes('22 1/2') || text.includes('22.5') || text === '22') return `${IMAGE_BASE}/bds-22.webp`;
  if (text.includes('fitting 45')) return `${IMAGE_BASE}/bds-fit-45.webp`;
  if (/^45\b/.test(text) || /\b45\b/.test(text)) return `${IMAGE_BASE}/bds-45.webp`;
  if (text.includes('fitting 90')) return `${IMAGE_BASE}/bds-fitting-90.webp`;
  if (/\b90\b/.test(text)) return `${IMAGE_BASE}/bds-90.webp`;
  return null;
};

async function updateDatabase({ dryRun = false } = {}) {
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const parts = await sql`
      select pd.id, pd."displayName", pd.description, pd."imageUrl", c.name as category
      from kublai_part_definition pd
      left join kublai_material m on m.id = pd."materialId"
      left join kublai_category c on c.id = pd."categoryId"
      where m.name = 'BDS' and pd."isActive" = true
      order by pd."displayName"
    `;

    const matches = parts
      .map((part) => ({ ...part, nextImageUrl: imageForDescription(part.description, part.category) }))
      .filter((part) => part.nextImageUrl && part.imageUrl !== part.nextImageUrl);

    const backupDir = path.join(process.cwd(), 'state-backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `bds-image-backup-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), matches }, null, 2));

    if (!dryRun) {
      await sql.begin(async (tx) => {
        for (const part of matches) {
          await tx`update kublai_part_definition set "imageUrl" = ${part.nextImageUrl} where id = ${part.id}`;
        }
      });
    }

    const skipped = parts.filter((part) => !imageForDescription(part.description, part.category));
    return { totalParts: parts.length, updated: matches.length, skipped: skipped.length, backupPath, matches, skipped };
  } finally {
    await sql.end();
  }
}

function updateWorkbook() {
  let XLSX;
  try {
    XLSX = require('xlsx');
  } catch {
    return { updated: 0, reason: 'xlsx package not available' };
  }
  if (!fs.existsSync(WORKBOOK_PATH)) return { updated: 0, reason: `missing ${WORKBOOK_PATH}` };

  const workbook = XLSX.readFile(WORKBOOK_PATH);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  let updated = 0;
  for (const row of rows) {
    const imageUrl = imageForDescription(row.description || row.aliases, row.category);
    if (imageUrl && row.imageUrl !== imageUrl) {
      row.imageUrl = imageUrl;
      updated += 1;
    }
  }
  workbook.Sheets[sheetName] = XLSX.utils.json_to_sheet(rows, {
    header: ['partId', 'catalog', 'category', 'material', 'displayName', 'description', 'sizeNominal', 'sizeUnit', 'imageUrl', 'aliases', 'isActive'],
  });
  try {
    XLSX.writeFile(workbook, WORKBOOK_PATH);
    return { updated, workbookPath: WORKBOOK_PATH };
  } catch (error) {
    return {
      updated: 0,
      reason: `Could not write workbook (${error.code ?? error.message}). It may be open/locked by Excel or OneDrive.`,
      intendedUpdates: updated,
      workbookPath: WORKBOOK_PATH,
    };
  }
}

(async () => {
  const dryRun = process.argv.includes('--dry-run');
  const db = await updateDatabase({ dryRun });
  const workbook = dryRun ? null : updateWorkbook();
  console.log(JSON.stringify({ dryRun, db: { totalParts: db.totalParts, updated: db.updated, skipped: db.skipped.length, backupPath: db.backupPath }, workbook }, null, 2));
  console.log('\nSample matches:');
  for (const part of db.matches.slice(0, 40)) console.log(`${part.displayName} -> ${part.nextImageUrl}`);
})();
