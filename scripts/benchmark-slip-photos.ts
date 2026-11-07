/** End-to-end packing-slip benchmark from synthetic phone photos.
 *
 * Each slip is printed in a real-world style (laser, pre-printed form, dot
 * matrix), marked up with a pen (ticks, corrected counts, handwritten pick
 * tickets) and photographed (src/server/packing-slips/test-photos.ts). The
 * photos then take the production path: the scanner's page detection on a
 * 480 px preview, corner refinement, flattening and JPEG; the PDF it saves;
 * the extract worker's OCR and page images; and analyzeSlip, with Jev reading
 * the page images.
 *
 *   node --env-file=.env --import tsx scripts/benchmark-slip-photos.ts [slips]
 *     [--from N] [--seed N] [--style laser|form|dotmatrix]
 *     [--marks clean|ticks|corrections|handwritten] [--text-only]
 *     [--capture-only] [--hard] [--fresh] [--verbose] [--trace] [--tag NAME]
 *     [--latency MS] [--workers N]
 *
 * Jev answers are cached per request in .tmp/slip-photos/cache, so a re-run
 * only pays for requests whose images or questions changed; --fresh asks
 * again. --latency makes each cached answer take as long as Jev took to give
 * it, or MS where that was not recorded, so the analysis time shows how long
 * the reading takes without paying for it. --workers sets how many slips are
 * read at once (2). --trace saves each request's images, questions and answers under
 * .tmp/slip-photos/trace/<tag>/<seed>. Per order item: "correct" = prefilled
 * with the right amount, or rightly left alone; "review" = left for the user;
 * "wrong" = prefilled with a wrong amount. Prefilling the printed amount where
 * a pen correction says otherwise is also counted as a "missed correction".
 * --capture-only stops after page detection, for quick runs over many photos;
 * --hard adds other papers, thumbs, glare, steep angles and dim light to the
 * photos.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  convertSlipQuantity,
  proposedReceipts,
  type SlipAnalysis,
  type SlipLine,
} from "../src/lib/packing-slip-review";
import {
  detectPage,
  locatePage,
  rectifyPage,
  scanPdf,
  type Pixels,
  type Quad,
} from "../src/lib/scanning/page";
import { analyzeSlip } from "../src/server/packing-slips/analyze";
import type { SlipRow } from "../src/server/packing-slips/ocr-rows";
import {
  makePhotoSlip,
  photograph,
  type CameraOptions,
  type PenMarks,
  type PhotoSlip,
  type PrintStyle,
} from "../src/server/packing-slips/test-photos";
import {
  askJev,
  VISION_MODEL,
  type VisionAsk,
} from "../src/server/packing-slips/vision";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const count = /^\d+$/.test(args[0] ?? "") ? Number(args[0]) : 12;
const from = Number(option("from") ?? 1);
const only = option("seed");
const style = option("style") as PrintStyle | undefined;
const marks = option("marks") as PenMarks | undefined;
const textOnly = flag("text-only"),
  captureOnly = flag("capture-only"),
  hard = flag("hard"),
  fresh = flag("fresh"),
  verbose = flag("verbose"),
  tracing = flag("trace");
const tag = option("tag") ?? "run";
const workers = Number(option("workers") ?? 2);
const latency =
  option("latency") === undefined ? null : Number(option("latency"));
const root = path.resolve(import.meta.dirname, "..");
const scratch = path.join(root, ".tmp/slip-photos");
const cacheDir = path.join(scratch, "cache");
await mkdir(cacheDir, { recursive: true, mode: 0o700 });

// ---------- Jev, cached ----------

const usageOf = new AsyncLocalStorage<{ input: number; output: number }>();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const response = await realFetch(input, init);
  const usage = usageOf.getStore();
  if (usage && !response.ok) jev.failed++;
  if (usage && response.ok) {
    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as {
      usage?: { input_tokens?: number; output_tokens?: number };
    } | null;
    usage.input += body?.usage?.input_tokens ?? 0;
    usage.output += body?.usage?.output_tokens ?? 0;
  }
  return response;
};
const digest = (v: Buffer | string) =>
  createHash("sha256").update(v).digest("hex");
const jev = { calls: 0, cached: 0, failed: 0, input: 0, output: 0, ms: 0 };
const traceOf = new AsyncLocalStorage<{ dir: string; n: number }>();
async function trace(
  inputs: Parameters<VisionAsk>[0],
  questions: Parameters<VisionAsk>[1],
  answers: Awaited<ReturnType<VisionAsk>>,
) {
  const t = traceOf.getStore();
  if (!t) return;
  const k = String(++t.n).padStart(3, "0");
  for (const [name, v] of Object.entries(inputs))
    if (typeof v !== "string")
      await writeFile(path.join(t.dir, `${k}-${name}.png`), v, { mode: 0o600 });
  await writeFile(
    path.join(t.dir, `${k}.json`),
    JSON.stringify(
      {
        inputs: Object.fromEntries(
          Object.entries(inputs).map(([n, v]) => [
            n,
            typeof v === "string" ? v : `${k}-${n}.png`,
          ]),
        ),
        questions,
        answers,
      },
      null,
      1,
    ),
    { mode: 0o600 },
  );
}
const cachedAsk: VisionAsk = async (inputs, questions) => {
  const key = digest(
    JSON.stringify({
      model: VISION_MODEL,
      inputs: Object.fromEntries(
        Object.entries(inputs).map(([k, v]) => [
          k,
          typeof v === "string" ? v : `sha256:${digest(v)}`,
        ]),
      ),
      questions,
    }),
  );
  const file = path.join(cacheDir, `${key}.json`);
  if (!fresh) {
    const hit = (await readFile(file, "utf8")
      .then(JSON.parse)
      .catch(() => null)) as {
      answers: Awaited<ReturnType<VisionAsk>>;
      ms?: number;
    } | null;
    if (hit) {
      jev.cached++;
      if (latency !== null)
        await new Promise((r) => setTimeout(r, hit.ms ?? latency));
      await trace(inputs, questions, hit.answers);
      return hit.answers;
    }
  }
  const usage = { input: 0, output: 0 },
    started = performance.now();
  const answers = await usageOf.run(usage, () => askJev(inputs, questions));
  jev.calls++;
  jev.input += usage.input;
  jev.output += usage.output;
  const ms = Math.round(performance.now() - started);
  jev.ms += ms;
  await writeFile(
    file,
    JSON.stringify({
      at: new Date().toISOString(),
      questions: Object.keys(questions),
      answers,
      usage,
      ms,
    }),
    { mode: 0o600 },
  );
  await trace(inputs, questions, answers);
  return answers;
};

// ---------- Capture, as the scanner does it ----------

const PREVIEW = 480;
const raw = (p: Pixels) =>
  sharp(Buffer.from(p.data.buffer, p.data.byteOffset, p.data.byteLength), {
    raw: { width: p.width, height: p.height, channels: 4 },
  });
type Capture = {
  jpeg: Buffer;
  detected: boolean;
  /** Worst corner, as a fraction of the page width in the frame. */
  cornerError: number;
  photo: Pixels;
  /** Camera blur in thousandths of the page width, as pageBlur measures it. */
  blur: number;
  hazards: CameraOptions["hazards"];
};
async function capture(page: Pixels, seed: number, folds: number[]) {
  const { frame, corners, options } = await photograph(page, seed, {
    folds,
    hard,
  });
  const scale = PREVIEW / Math.max(frame.width, frame.height);
  const pw = Math.round(frame.width * scale),
    ph = Math.round(frame.height * scale);
  const preview = await raw(frame)
    .resize(pw, ph, { fit: "fill" })
    .raw()
    .toBuffer();
  const found = detectPage(
    new Uint8ClampedArray(
      preview.buffer,
      preview.byteOffset,
      preview.byteLength,
    ),
    pw,
    ph,
  );
  // Nothing detected: the scanner asks for the corners, placed by hand.
  const jitter = (v: number, k: number) =>
    v + (((seed * 7 + k * 13) % 9) - 4) * 0.002;
  const outline: Quad = found.quad
    ? locatePage(frame, found.quad)
    : (corners.map((p, k) => ({
        x: jitter(p.x, k),
        y: jitter(p.y, k + 4),
      })) as Quad);
  const width = Math.hypot(
    (corners[1].x - corners[0].x) * frame.width,
    (corners[1].y - corners[0].y) * frame.height,
  );
  const cornerError =
    Math.max(
      ...outline.map((p, k) =>
        Math.hypot(
          (p.x - corners[k]!.x) * frame.width,
          (p.y - corners[k]!.y) * frame.height,
        ),
      ),
    ) / width;
  const flat = await rectifyPage(frame, outline);
  const jpeg = await raw(flat).jpeg({ quality: 85 }).toBuffer();
  return {
    jpeg,
    detected: Boolean(found.quad),
    cornerError,
    photo: frame,
    blur: (options.blur * 1000) / width,
    hazards: options.hazards,
  } satisfies Capture;
}

// ---------- The extract worker ----------

async function extract(pdf: Buffer, dir: string) {
  const source = path.join(dir, "slip.pdf"),
    target = path.join(dir, "text.json");
  await writeFile(source, pdf, { mode: 0o600 });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=512",
        "--import",
        "tsx",
        path.join(root, "src/server/packing-slips/extract-worker.ts"),
        source,
        target,
        "application/pdf",
      ],
      {
        cwd: root,
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, OMP_THREAD_LIMIT: "1" },
      },
    );
    let errors = "";
    child.stderr.on("data", (d: Buffer) => (errors += d.toString()));
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(Error(`extract worker failed: ${errors.slice(-300)}`)),
    );
  });
  const parsed = JSON.parse(await readFile(target, "utf8")) as {
    rows: SlipRow[];
    warnings: string[];
  };
  const pages: Buffer[] = [];
  for (let n = 1; n <= 20; n++) {
    const png = await readFile(path.join(dir, `page-${n}.png`)).catch(
      () => null,
    );
    if (!png) break;
    pages.push(png);
  }
  return { ...parsed, pages };
}

// ---------- Scoring ----------

type Tally = { correct: number; review: number; wrong: number };
const tally = (): Tally => ({ correct: 0, review: 0, wrong: 0 });
const total = tally();
const byStyle: Record<string, Tally> = {},
  byMarks: Record<string, Tally> = {};
const stats = {
  pages: 0,
  detected: 0,
  cornerErrors: [] as number[],
  /** Outlines more than 2% of the page width off: part of the page is lost. */
  badOutlines: 0,
  qualityWarned: 0,
  blurryPages: 0,
  blurryWarned: 0,
  lines: 0,
  found: 0,
  printedRight: 0,
  printedLines: 0,
  corrections: 0,
  correctionsMissed: 0,
  handLines: 0,
  handFlagged: 0,
  handOneTap: 0,
  falseHand: 0,
  extras: 0,
  extrasFlagged: 0,
  backorders: 0,
  backordersRead: 0,
  oneTap: 0,
  slipWarnings: 0,
  captureMs: 0,
  extractMs: 0,
  analyzeMs: 0,
};
const failures: string[] = [];
const results: unknown[] = [];

/** The quantity printed (or, on a pick ticket, written) on a slip line. */
function slipQuantity(slip: PhotoSlip, line: number) {
  for (const page of slip.pages)
    for (const t of page.texts)
      if (t.line === line && (t.field === "shipped" || t.field === "qty"))
        return Number(t.text);
  return null;
}
const words = (s: string) =>
  new Set(
    s
      .toUpperCase()
      .split(/[^A-Z0-9/]+/)
      .filter((w) => w.length > 1),
  );
function similar(a: string, b: string) {
  const x = words(a),
    y = words(b);
  let same = 0;
  for (const w of x) if (y.has(w)) same++;
  return same / Math.max(1, Math.min(x.size, y.size));
}

async function one(seed: number) {
  const slip = makePhotoSlip(seed, { style, marks });
  const dir = path.join(scratch, "work", String(seed));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const t0 = performance.now();
  const shots: Capture[] = [];
  for (let p = 0; p < slip.images.length; p++)
    shots.push(await capture(slip.images[p]!, seed * 10 + p, slip.folds));
  for (const [p, shot] of shots.entries()) {
    await raw(shot.photo)
      .resize({ width: 1000 })
      .jpeg({ quality: 80 })
      .toFile(path.join(dir, `photo-${p + 1}.jpg`));
    await writeFile(path.join(dir, `scan-${p + 1}.jpg`), shot.jpeg, {
      mode: 0o600,
    });
  }
  const t1 = performance.now();
  stats.captureMs += t1 - t0;
  const blurry = new Set<number>();
  for (const [p, shot] of shots.entries()) {
    stats.pages++;
    if (shot.detected) stats.detected++;
    stats.cornerErrors.push(shot.cornerError);
    if (shot.cornerError > 0.02) stats.badOutlines++;
    if (shot.blur >= 1.6) blurry.add(p + 1);
  }
  const pageSummary = shots
    .map((s) =>
      s.detected ? `ok ${(s.cornerError * 100).toFixed(1)}%` : "MANUAL",
    )
    .join(", ");
  if (captureOnly) {
    results.push({
      seed,
      style: slip.style,
      layout: slip.layout,
      folds: slip.folds,
      pages: shots.map((s) => ({
        detected: s.detected,
        cornerError: s.cornerError,
        hazards: s.hazards,
      })),
    });
    console.log(`seed ${seed} ${slip.style} ${slip.layout}: ${pageSummary}`);
    return;
  }
  const file = await scanPdf(
    shots.map((s) => `data:image/jpeg;base64,${s.jpeg.toString("base64")}`),
  );
  const extracted = await extract(Buffer.from(await file.arrayBuffer()), dir);
  const t2 = performance.now();
  const analyze = () =>
    analyzeSlip(
      extracted.rows,
      slip.items,
      async () => {
        throw Error("No text evaluator in the benchmark");
      },
      textOnly ? undefined : { pages: extracted.pages, ask: cachedAsk },
    );
  const traceDir = path.join(scratch, "trace", tag, String(seed));
  if (tracing) await mkdir(traceDir, { recursive: true, mode: 0o700 });
  const result = await (
    tracing ? traceOf.run({ dir: traceDir, n: 0 }, analyze) : analyze()
  ).catch((e: Error) => ({
    lines: [] as SlipLine[],
    warnings: [e.message],
    model: "",
  }));
  const t3 = performance.now();
  stats.extractMs += t2 - t1;
  stats.analyzeMs += t3 - t2;

  // Capture warnings
  const warned = new Set(
    extracted.warnings
      .map((w) => /^Page (\d+)/.exec(w)?.[1])
      .filter(Boolean)
      .map(Number),
  );
  stats.qualityWarned += warned.size;
  stats.blurryPages += blurry.size;
  for (const p of blurry) if (warned.has(p)) stats.blurryWarned++;
  stats.slipWarnings += result.warnings.length;

  // Order items
  const proposed = proposedReceipts({ lines: result.lines } as SlipAnalysis);
  const styleTally = (byStyle[slip.style] ??= tally()),
    marksTally = (byMarks[slip.marks] ??= tally());
  const itemResults = slip.items.map((item) => {
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
    styleTally[outcome]++;
    marksTally[outcome]++;
    const lines = result.lines.filter((l) => l.orderItemId === item.id);
    const line = lines[0];
    // What the user can accept with one tap when nothing was prefilled.
    const written =
      line?.handwritten !== undefined
        ? convertSlipQuantity(
            line.handwritten,
            line.unit ?? (item.piecesPerPack ? null : item.unit),
            item,
          )
        : null;
    if (outcome === "review" && truth && written === truth.shipped)
      stats.oneTap++;
    if (outcome !== "correct")
      failures.push(
        `${seed} ${slip.style}/${slip.marks} ${outcome}: "${item.description}" expected ${truth ? truth.shipped : "absent"}` +
          `${truth?.written !== undefined ? ` (printed ${truth.printed}, written ${truth.written})` : ""} got ${got ?? "-"}` +
          (line
            ? ` | read ${line.shipped}${line.handwritten !== undefined ? ` hand ${line.handwritten}` : ""} | ${line.issues.join(" ")}`
            : " | no line"),
      );
    if (truth && truth.backordered > 0) {
      stats.backorders++;
      if (line?.backordered === truth.backordered) stats.backordersRead++;
    }
    return { item: item.id, outcome, got, truth, line: line ?? null };
  });

  // Slip lines
  for (const [i, truth] of slip.truth.entries()) {
    stats.lines++;
    const line = truth.itemId
      ? result.lines.find((l) => l.orderItemId === truth.itemId)
      : result.lines.find(
          (l) =>
            !l.orderItemId &&
            similar(l.description ?? l.evidence, truth.description) >= 0.6,
        );
    if (!truth.itemId) {
      stats.extras++;
      if (line) stats.extrasFlagged++;
    }
    if (!line) continue;
    stats.found++;
    const printed = slip.marks === "handwritten" ? null : slipQuantity(slip, i);
    if (printed !== null) {
      stats.printedLines++;
      if (line.shipped === printed) stats.printedRight++;
    }
    if (truth.written !== undefined) {
      stats.handLines++;
      if (line.handwritten !== undefined) stats.handFlagged++;
      const item = slip.items.find((x) => x.id === truth.itemId);
      if (
        item &&
        line.handwritten !== undefined &&
        convertSlipQuantity(
          line.handwritten,
          line.unit ?? (item.piecesPerPack ? null : item.unit),
          item,
        ) === truth.written
      )
        stats.handOneTap++;
      if (slip.marks === "corrections") {
        stats.corrections++;
        if (truth.itemId && proposed[truth.itemId] === truth.printed)
          stats.correctionsMissed++;
      }
    } else if (line.handwritten !== undefined) stats.falseHand++;
  }
  results.push({
    seed,
    style: slip.style,
    marks: slip.marks,
    layout: slip.layout,
    pages: shots.map((s) => ({
      detected: s.detected,
      cornerError: s.cornerError,
    })),
    analyzeMs: Math.round(t3 - t2),
    extractWarnings: extracted.warnings,
    warnings: result.warnings,
    model: result.model,
    items: itemResults,
    lines: result.lines,
    truth: slip.truth,
  });
  const mine = itemResults.reduce(
    (t, r) => ({ ...t, [r.outcome]: t[r.outcome] + 1 }),
    tally(),
  );
  console.log(
    `seed ${seed} ${slip.style}/${slip.marks} ${slip.layout}: ${mine.correct} correct, ${mine.review} review, ${mine.wrong} wrong` +
      ` | pages ${pageSummary}` +
      ` | ${((t3 - t0) / 1000).toFixed(0)}s, analyze ${((t3 - t2) / 1000).toFixed(1)}s`,
  );
}

const seeds =
  only !== undefined
    ? [Number(only)]
    : Array.from({ length: count }, (_, i) => i + from);
const pool = Array.from({ length: workers }, async () => {
  for (let seed = seeds.shift(); seed !== undefined; seed = seeds.shift())
    await one(seed).catch((e: Error) => {
      console.log(`seed ${seed} FAILED: ${e.message}`);
      failures.push(`${seed} failed: ${e.message}`);
    });
});
await Promise.all(pool);

const items = total.correct + total.review + total.wrong;
const pct = (n: number, d: number) =>
  `${((100 * n) / Math.max(1, d)).toFixed(1)}%`;
const fmt = (t: Tally) => {
  const n = t.correct + t.review + t.wrong;
  return `${pct(t.correct, n)} correct, ${pct(t.review, n)} review, ${t.wrong} wrong (${n})`;
};
const errors = [...stats.cornerErrors].sort((a, b) => a - b);
if (!captureOnly) {
  console.log(
    `\n${results.length} slips, ${items} order items (${textOnly ? "text only" : `vision ${VISION_MODEL}`}): ${fmt(total)}`,
  );
  for (const [k, t] of Object.entries(byStyle))
    console.log(`  ${k}: ${fmt(t)}`);
  for (const [k, t] of Object.entries(byMarks))
    console.log(`  ${k}: ${fmt(t)}`);
}
console.log(
  `capture: page found ${stats.detected}/${stats.pages}, outline off by more than 2% ${stats.badOutlines}, corner error median ${(100 * (errors[Math.floor(errors.length / 2)] ?? 0)).toFixed(2)}% max ${(100 * (errors.at(-1) ?? 0)).toFixed(2)}%` +
    (captureOnly
      ? ""
      : `; quality warnings on ${stats.qualityWarned} pages (very blurry photos warned ${stats.blurryWarned}/${stats.blurryPages})`),
);
if (!captureOnly) {
  console.log(
    `lines: found ${stats.found}/${stats.lines}, printed shipped read ${stats.printedRight}/${stats.printedLines}, backorders read ${stats.backordersRead}/${stats.backorders}, extras flagged ${stats.extrasFlagged}/${stats.extras}`,
  );
  console.log(
    `pen: handwritten counts flagged ${stats.handFlagged}/${stats.handLines}, read right ${stats.handOneTap}/${stats.handLines}, false handwriting ${stats.falseHand};` +
      ` corrections missed (printed prefilled) ${stats.correctionsMissed}/${stats.corrections}; review items fixable with one tap ${stats.oneTap}/${total.review}`,
  );
}
console.log(
  `cost: ${jev.calls} Jev calls (${jev.cached} cached, ${jev.failed} failed and retried), ${jev.input} input + ${jev.output} output tokens;` +
    ` time capture ${(stats.captureMs / 1000).toFixed(0)}s, extract ${(stats.extractMs / 1000).toFixed(0)}s, analyze ${(stats.analyzeMs / 1000).toFixed(0)}s`,
);
if (verbose) for (const f of failures) console.log(`  ${f}`);
const runs = path.join(scratch, "runs");
await mkdir(runs, { recursive: true, mode: 0o700 });
const out = path.join(
  runs,
  `${tag}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
await writeFile(
  out,
  JSON.stringify(
    { tag, args, total, byStyle, byMarks, stats, jev, failures, results },
    null,
    1,
  ),
  { mode: 0o600 },
);
console.log(`details: ${path.relative(root, out)}`);
