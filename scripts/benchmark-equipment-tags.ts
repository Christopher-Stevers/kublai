/** Equipment-tag recognition against public MEP bid sets. Read-only: it never
 * touches the database or uploads. PDFs are cached outside the repository.
 *
 *   node --import tsx scripts/benchmark-equipment-tags.ts [cache-dir] [source ...]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { equipmentIndex } from "../src/server/drawings/equipment-index";
import {
  drawingSheetNumbers,
  equipmentScheduleTags,
  equipmentTagsOnPage,
} from "../src/lib/equipment-tags";

type Expect = { find?: string[]; schedule?: string[]; reject?: string[]; sheets?: string[] };
type Source = { title: string; url: string; pdf_sha256: string; expect?: Expect };
const manifest = JSON.parse(
  readFileSync(path.resolve("docs/references/equipment-tags/manifest.json"), "utf8"),
) as { sources: Record<string, Source> };
const [cacheArg, ...only] = process.argv.slice(2);
const cache = path.resolve(cacheArg ?? "/tmp/foremanhq-equipment-tags");
mkdirSync(cache, { recursive: true });

const failures: string[] = [];
const totals = { pages: 0, schedule: 0, recognised: 0, unscheduled: 0 };
for (const [name, source] of Object.entries(manifest.sources)) {
  if (only.length && !only.includes(name)) continue;
  const file = path.join(cache, `${name}.pdf`);
  if (!existsSync(file)) {
    const response = await fetch(source.url);
    if (!response.ok) {
      failures.push(`${name}: download failed (${response.status})`);
      continue;
    }
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (hash !== source.pdf_sha256) {
    failures.push(`${name}: file changed upstream (sha256 ${hash})`);
    continue;
  }
  const { pages } = await equipmentIndex(file, "pdf");
  const sheetNumbers = drawingSheetNumbers(pages);
  const knownTags = equipmentScheduleTags(pages, { sheetNumbers });
  const recognised = new Set(
    pages.flatMap((page) => equipmentTagsOnPage(page.words, { knownTags, sheetNumbers }).map((tag) => tag.text)),
  );
  const known = new Set(knownTags);
  const unscheduled = [...recognised].filter((tag) => !known.has(tag));
  totals.pages += pages.length;
  totals.schedule += known.size;
  totals.recognised += recognised.size;
  totals.unscheduled += unscheduled.length;
  const expect = source.expect ?? {};
  const missing = [
    ...(expect.find ?? []).filter((tag) => !recognised.has(tag)).map((tag) => `not found ${tag}`),
    ...(expect.schedule ?? []).filter((tag) => !known.has(tag)).map((tag) => `not learned ${tag}`),
    ...(expect.reject ?? []).filter((tag) => recognised.has(tag) || known.has(tag)).map((tag) => `wrongly linked ${tag}`),
    ...(expect.sheets ?? []).filter((tag) => !sheetNumbers.includes(tag)).map((tag) => `sheet missed ${tag}`),
  ];
  for (const problem of missing) failures.push(`${name}: ${problem}`);
  console.log(
    `${name.padEnd(16)} ${String(pages.length).padStart(4)} pages  ${String(known.size).padStart(4)} scheduled  ${String(recognised.size).padStart(4)} recognised  ${String(sheetNumbers.length).padStart(3)} sheets${missing.length ? `  ✗ ${missing.length}` : ""}`,
  );
  if (process.env.VERBOSE) console.log(`  unscheduled: ${unscheduled.sort().join(" ")}`);
}
console.log(
  `\n${totals.pages} pages, ${totals.schedule} scheduled tags, ${totals.recognised} recognised (${totals.unscheduled} not in a schedule)`,
);
if (failures.length) {
  console.log(`\n${failures.length} expectation(s) failed:\n  ${failures.join("\n  ")}`);
  process.exitCode = 1;
} else console.log("All expectations met.");
