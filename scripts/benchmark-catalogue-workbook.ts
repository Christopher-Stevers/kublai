import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  buildCatalogueWorkbook,
  normalizeCatalogueImportRows,
  parseCatalogueWorkbook,
} from "../src/lib/catalogue-xlsx-core";
const [reportPath, fixturePath] = process.argv.slice(2);
if (!reportPath || !fixturePath)
  throw Error(
    "Usage: benchmark-catalogue-workbook.ts report.json fixture.xlsx",
  );
const rows = Array.from({ length: 10000 }, (_, i) => ({
  partId: `QA-${i}`,
  catalog: "QA Plumbing",
  category: "Fittings",
  material: "Copper",
  displayName: `QA pipe fitting ${i}`,
  description: "",
  sizeNominal: "0.5",
  sizeUnit: "in",
  imageUrl: "",
  aliases: `QA alias ${i}`,
  isActive: i % 5 !== 0,
}));
const exportTimes = [],
  importTimes = [];
let fixture = new ArrayBuffer(0);
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const expected = hash(normalizeCatalogueImportRows(rows));
for (let i = 0; i < 4; i++) {
  const start = performance.now();
  fixture = await buildCatalogueWorkbook(rows);
  const encoded = performance.now();
  const imported = await parseCatalogueWorkbook(fixture);
  const end = performance.now();
  if (hash(imported) !== expected) throw Error("Workbook contents differ");
  if (i) {
    exportTimes.push(encoded - start);
    importTimes.push(end - encoded);
  }
}
await writeFile(fixturePath, Buffer.from(fixture));
const result = {
  synthetic: true,
  rows: rows.length,
  bytes: fixture.byteLength,
  exportTimesMs: exportTimes,
  importTimesMs: importTimes,
  exportMedianMs: [...exportTimes].sort((a, b) => a - b)[1],
  importMedianMs: [...importTimes].sort((a, b) => a - b)[1],
  normalizedRowsSha256: expected,
  note: "Unchanged SheetJS algorithms. Worker placement improves responsiveness, not parsing speed.",
};
await writeFile(reportPath, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
