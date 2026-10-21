/** Packing-slip reading and order matching against synthetic supplier slips.
 * By default each page is painted, lightly degraded like a phone scan and
 * read with Tesseract exactly as the extract worker does; --text uses exact
 * text positions instead (PDFs with a text layer).
 *
 *   node --import tsx scripts/benchmark-packing-slips.ts [slips] [--text]
 *     [--verbose] [--from <first seed>] [--seed <one seed, dumps its rows>]
 *
 * Per order item: "correct" = the prefilled delivery quantity is right,
 * "review" = left blank for the user, "wrong" = prefilled with a wrong amount
 * (or prefilled although the item is not on the slip).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";
import { analyzeSlip } from "../src/server/packing-slips/analyze";
import { readSlipTable } from "../src/server/packing-slips/read-table";
import type { SlipRow } from "../src/server/packing-slips/ocr-rows";
import { ocrPage, type Tesseract } from "../src/server/packing-slips/ocr-page";
import {
  makeSlip,
  slipRows,
  type TestSlip,
} from "../src/server/packing-slips/test-slips";
import {
  proposedReceipts,
  type SlipAnalysis,
} from "../src/lib/packing-slip-review";

const run = promisify(execFile);
const count = Number(process.argv[2] ?? 60);
const textLayer = process.argv.includes("--text");
const verbose = process.argv.includes("--verbose");
const only = process.argv.includes("--seed")
  ? Number(process.argv[process.argv.indexOf("--seed") + 1])
  : null;
const W = 1700,
  H = 2200;

function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function paint(slip: TestSlip, page: number, seed: number) {
  const rnd = random(seed * 31 + page);
  const canvas = createCanvas(W, H),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  const ink = Math.round(20 + rnd() * 50);
  ctx.fillStyle = ctx.strokeStyle = `rgb(${ink},${ink},${ink + 10})`;
  const family = slip.mono ? "Liberation Mono" : "Liberation Sans";
  for (const t of slip.pages[page]!.texts) {
    ctx.font = `${t.bold ? "bold " : ""}${Math.round(t.size * H)}px "${family}"`;
    ctx.textAlign = t.align;
    ctx.fillText(t.text, t.x * W, t.y * H);
  }
  ctx.lineWidth = 2;
  for (const r of slip.pages[page]!.rules) {
    ctx.beginPath();
    ctx.moveTo(r.x1 * W, r.y1 * H);
    ctx.lineTo(r.x2 * W, r.y2 * H);
    ctx.stroke();
  }
  // Phone scan: slight residual rotation, softness, uneven light, noise, JPEG.
  const image = ctx.getImageData(0, 0, W, H),
    d = image.data;
  const noise = 6 + rnd() * 14,
    shade = rnd() * 0.18;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const light = 1 - shade * (x / W) * (y / H);
      const n = (rnd() - 0.5) * noise;
      for (let k = 0; k < 3; k++) d[i + k] = d[i + k]! * light + n;
    }
  ctx.putImageData(image, 0, 0);
  const angle = (rnd() - 0.5) * 1.2;
  return sharp(canvas.toBuffer("image/png"))
    .rotate(angle, { background: "#ffffff" })
    .blur(0.4 + rnd() * 0.7)
    .jpeg({ quality: Math.round(55 + rnd() * 30) })
    .toBuffer();
}

/** The extract worker's OCR step. */
const tesseract: Tesseract = async (args, input) => {
  const child = run("tesseract", args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, OMP_THREAD_LIMIT: "1" },
  });
  child.child.stdin!.end(input);
  return (await child).stdout;
};
const ocr = (jpeg: Buffer, page: number, earlier: SlipRow[]) =>
  ocrPage(jpeg, page, tesseract, earlier);

type Tally = { correct: number; review: number; wrong: number };
const total: Tally = { correct: 0, review: 0, wrong: 0 };
const byLayout: Record<string, Tally> = {};
let backorders = 0,
  backordersRead = 0,
  extras = 0,
  extrasFlagged = 0,
  ocrMs = 0,
  analyzeMs = 0;
const failures: string[] = [];

async function one(seed: number) {
  const slip = makeSlip(seed);
  let rows: SlipRow[];
  const t0 = performance.now();
  if (textLayer) rows = slipRows(slip);
  else {
    rows = [];
    for (let p = 0; p < slip.pages.length; p++)
      rows.push(...(await ocr(await paint(slip, p, seed), p + 1, rows)));
  }
  const t1 = performance.now();
  if (only !== null) {
    const table = readSlipTable(rows);
    for (const l of table.layouts)
      console.log(
        `page ${l.page}: ${l.columns.map((c) => `${c.field}[${c.label}]`).join(" ")}`,
      );
    for (const r of rows)
      console.log(
        `  p${r.page} ${r.words.map((w) => `${w.text}@${w.x.toFixed(2)},${w.y.toFixed(3)}:${w.confidence.toFixed(0)}`).join(" ")}`,
      );
  }
  const result = await analyzeSlip(rows, slip.items, async () => {
    throw Error("No evaluator in the benchmark");
  }).catch((e: Error) => ({ lines: [], warnings: [e.message], model: "" }));
  const t2 = performance.now();
  ocrMs += t1 - t0;
  analyzeMs += t2 - t1;
  const proposed = proposedReceipts({ lines: result.lines } as SlipAnalysis);
  const tally = (byLayout[slip.layout] ??= { correct: 0, review: 0, wrong: 0 });
  for (const item of slip.items) {
    const truth = slip.truth.find((t) => t.itemId === item.id);
    const got = proposed[item.id];
    const outcome: keyof Tally =
      got === undefined
        ? truth
          ? "review"
          : "correct"
        : truth && Math.abs(got - truth.shipped) < 1e-6
          ? "correct"
          : "wrong";
    total[outcome]++;
    tally[outcome]++;
    const line = result.lines.find((l) => l.orderItemId === item.id);
    if (outcome !== "correct")
      failures.push(
        `${slip.name} ${outcome}: "${item.description}" expected ${truth ? truth.shipped : "absent"} got ${got ?? "-"}` +
          (line
            ? ` | ${line.evidence} | ${line.issues.join(" ")}`
            : " | no line"),
      );
    if (truth && truth.backordered > 0) {
      backorders++;
      if (line?.backordered === truth.backordered) backordersRead++;
    }
  }
  for (const t of slip.truth.filter((t) => !t.itemId)) {
    extras++;
    const word = t.description.split(" ")[0]!;
    if (result.lines.some((l) => !l.orderItemId && l.evidence.includes(word)))
      extrasFlagged++;
  }
}

const from = process.argv.includes("--from")
  ? Number(process.argv[process.argv.indexOf("--from") + 1])
  : 1;
const seeds =
  only !== null ? [only] : Array.from({ length: count }, (_, i) => i + from);
const workers = Array.from({ length: textLayer ? 1 : 4 }, async () => {
  for (let seed = seeds.shift(); seed !== undefined; seed = seeds.shift())
    await one(seed);
});
await Promise.all(workers);
const items = total.correct + total.review + total.wrong;
const pct = (n: number, d: number) =>
  `${((100 * n) / Math.max(1, d)).toFixed(1)}%`;
console.log(
  `${count} slips, ${items} order items (${textLayer ? "text layer" : "scanned + OCR"}): ` +
    `correct ${pct(total.correct, items)}, left for review ${pct(total.review, items)}, wrong ${pct(total.wrong, items)} (${total.wrong})`,
);
console.log(
  `backorders read ${backordersRead}/${backorders}, extra slip lines flagged ${extrasFlagged}/${extras}, ` +
    `${(ocrMs / count).toFixed(0)} ms reading + ${(analyzeMs / count).toFixed(1)} ms matching per slip`,
);
console.log(
  Object.entries(byLayout)
    .map(
      ([name, t]) =>
        `${name} ${t.correct}/${t.correct + t.review + t.wrong} (${t.wrong} wrong)`,
    )
    .join("  "),
);
if (verbose) console.log(failures.join("\n"));
