/** Scores the slip reader against slips exported by export-slip-benchmark.
 * Each slip is read exactly as production does (extract worker, then
 * analyzeSlip with page images), and every order item's prefilled quantity is
 * compared with what the user confirmed:
 *   correct = prefilled and equal, or rightly left empty for an item not sent
 *   review  = left blank for the user
 *   wrong   = prefilled with a different amount
 * Image reading calls Jev and costs money; --text-only skips it.
 *
 *   node --import tsx scripts/score-slip-benchmark.ts [--in .tmp/slip-benchmark]
 *     [--tag name] [--text-only] [--verbose]
 */
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { analyzeSlip } from "../src/server/packing-slips/analyze";
import type { SlipRow } from "../src/server/packing-slips/ocr-rows";
import {
  proposedReceipts,
  type ReceiptOrderItem,
} from "../src/lib/packing-slip-review";

const arg = (name: string) =>
  process.argv.includes(name)
    ? process.argv[process.argv.indexOf(name) + 1]
    : undefined;
const input = path.resolve(arg("--in") ?? ".tmp/slip-benchmark");
const tag = arg("--tag") ?? new Date().toISOString().slice(0, 16);
const textOnly = process.argv.includes("--text-only");
const verbose = process.argv.includes("--verbose");

async function extract(source: string, mime: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "slip-bench-"));
  try {
    const target = path.join(dir, "text.json");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          path.resolve("src/server/packing-slips/extract-worker.ts"),
          source,
          target,
          mime,
        ],
        { stdio: "ignore" },
      );
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(Error(`extract exited ${code}`)),
      );
    });
    const { rows, warnings } = JSON.parse(await readFile(target, "utf8")) as {
      rows: SlipRow[];
      warnings: string[];
    };
    const pages: Buffer[] = [];
    for (let n = 1; ; n++)
      try {
        pages.push(await readFile(path.join(dir, `page-${n}.png`)));
      } catch {
        break;
      }
    return { rows, warnings, pages };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const tally = { correct: 0, review: 0, wrong: 0 };
const results: unknown[] = [];
const cases = (await readdir(input, { withFileTypes: true })).filter((d) =>
  d.isDirectory(),
);
for (const c of cases) {
  const dir = path.join(input, c.name);
  const kase = JSON.parse(
    await readFile(path.join(dir, "case.json"), "utf8"),
  ) as {
    id: string;
    mimeType: string;
    items: ReceiptOrderItem[];
    confirmed: Record<string, number>;
  };
  const source = (await readdir(dir)).find((f) => f.startsWith("source."));
  if (!source) continue;
  const started = Date.now();
  const extracted = await extract(path.join(dir, source), kase.mimeType);
  const analysis = await analyzeSlip(
    extracted.rows,
    kase.items,
    undefined,
    textOnly ? undefined : { pages: extracted.pages },
  );
  const proposed = proposedReceipts({
    ...analysis,
    runId: "",
    versionId: "",
    status: "ready",
    startedAt: "",
    items: kase.items,
  });
  const items = kase.items.map((item) => {
    const got = proposed[item.id];
    const want = kase.confirmed[item.id] ?? 0;
    const outcome =
      got === undefined
        ? want === 0
          ? "correct"
          : "review"
        : Math.abs(got - want) < 1e-6
          ? "correct"
          : "wrong";
    tally[outcome]++;
    if (verbose && outcome !== "correct")
      console.log(
        `${kase.id} ${outcome}: "${item.description}" confirmed ${want}, prefilled ${got ?? "-"}`,
      );
    return { id: item.id, outcome, prefilled: got ?? null, confirmed: want };
  });
  results.push({
    id: kase.id,
    ms: Date.now() - started,
    model: analysis.model,
    warnings: [...extracted.warnings, ...analysis.warnings],
    items,
  });
}
const total = tally.correct + tally.review + tally.wrong;
const pct = (n: number) => `${((100 * n) / Math.max(1, total)).toFixed(1)}%`;
console.log(
  `${results.length} slips, ${total} order items: correct ${pct(tally.correct)}, review ${pct(tally.review)}, wrong ${pct(tally.wrong)} (${tally.wrong})`,
);
await writeFile(
  path.join(input, `results-${tag}.json`),
  JSON.stringify({ tag, textOnly, tally, results }, null, 1),
  { mode: 0o600 },
);
