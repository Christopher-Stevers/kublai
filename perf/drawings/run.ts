// Host-only spike. Never imports a server mutator or changes uploads.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { classify, replayPaths } from "./operators";
const root = path.resolve("perf/drawings/private");
const corpus = JSON.parse(
  await readFile(path.join(root, "corpus.json"), "utf8"),
);
const names = Object.fromEntries(
  Object.entries(OPS).map(([key, value]) => [value, key]),
);
const glyphPrototype = process.env.DRAWING_GLYPH_PROTOTYPE === "1";
const shard = Number(process.env.DRAWING_SHARD ?? 0),
  shards = Number(process.env.DRAWING_SHARDS ?? 1);
const reports: any[] = [];
let prior: any[] = [];
for (const suffix of ["0", "1", "2", "3", "eb8da2f0", "7725eb4b"])
  try {
    prior.push(
      ...JSON.parse(
        await readFile(path.join(root, `measurements-${suffix}.json`), "utf8"),
      ).sheets.filter((r: any) => !r.error),
    );
  } catch {}
await mkdir(path.join(root, "previews"), { recursive: true });
function metrics(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
) {
  let inkA = 0,
    inkB = 0,
    min = 1,
    total = 0,
    tiles = 0;
  const lum = (x: Uint8ClampedArray, i: number) =>
    0.2126 * x[i]! + 0.7152 * x[i + 1]! + 0.0722 * x[i + 2]!;
  for (let y = 0; y < height; y += 64)
    for (let x = 0; x < width; x += 64) {
      let n = 0,
        sa = 0,
        sb = 0,
        saa = 0,
        sbb = 0,
        sab = 0;
      for (let yy = y; yy < Math.min(height, y + 64); yy++)
        for (let xx = x; xx < Math.min(width, x + 64); xx++) {
          const i = (yy * width + xx) * 4,
            u = lum(a, i),
            v = lum(b, i);
          n++;
          sa += u;
          sb += v;
          saa += u * u;
          sbb += v * v;
          sab += u * v;
          if (u < 245) inkA++;
          if (v < 245) inkB++;
        }
      const ma = sa / n,
        mb = sb / n,
        va = saa / n - ma * ma,
        vb = sbb / n - mb * mb,
        cov = sab / n - ma * mb;
      const ssim =
        ((2 * ma * mb + 6.5025) * (2 * cov + 58.5225)) /
        ((ma * ma + mb * mb + 6.5025) * (va + vb + 58.5225));
      min = Math.min(min, ssim);
      total += ssim;
      tiles++;
    }
  return {
    minTileSsim: min,
    meanTileSsim: total / tiles,
    inkCoverageDifference: Math.abs(inkA - inkB) / (width * height),
    passes: min >= 0.98 && Math.abs(inkA - inkB) / (width * height) <= 0.005,
  };
}
for (const [sampleIndex, sample] of corpus.samples.entries()) {
  if (sampleIndex % shards !== shard) continue;
  if (glyphPrototype && sampleIndex >= 10) continue;
  const previous = prior.find((r: any) => r.hash === sample.hash);
  if (previous && !process.env.DRAWING_ONLY_HASH && !glyphPrototype) {
    reports.push(previous);
    continue;
  }
  if (
    process.env.DRAWING_ONLY_HASH &&
    !sample.hash.startsWith(process.env.DRAWING_ONLY_HASH)
  )
    continue;
  let loading: any;
  try {
    const bytes = await readFile(sample.file);
    loading = getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: false,
      fontExtraProperties: glyphPrototype,
      disableFontFace: true,
      standardFontDataUrl:
        path.resolve("node_modules/pdfjs-dist/standard_fonts") + "/",
      cMapUrl: path.resolve("node_modules/pdfjs-dist/cmaps") + "/",
      cMapPacked: true,
      wasmUrl: path.resolve("node_modules/pdfjs-dist/wasm") + "/",
    });
    const doc = await loading.promise,
      page = await doc.getPage(1),
      viewport = page.getViewport({ scale: 1 });
    const start = performance.now(),
      list = await page.getOperatorList(),
      operatorListMs = performance.now() - start;
    const classification = classify(list, names);
    const text = (await page.getTextContent()).items
      .map((item: any) => item.str ?? "")
      .join(" ");
    const trades = Object.entries({
      plumbing: /plumbing|sanitary|domestic water/i,
      mechanical: /mechanical|hvac|ductwork/i,
      electrical: /electrical|lighting|power plan/i,
      structural: /structural|reinforc|concrete/i,
      architectural: /architectural|floor plan|partition/i,
      fire: /fire protection|sprinkler/i,
    })
      .filter(([, rule]) => (rule as RegExp).test(text))
      .map(([trade]) => trade);
    const fonts = [];
    for (let i = 0; i < list.fnArray.length; i++)
      if (names[list.fnArray[i]] === "setFont") {
        const id = list.argsArray[i][0];
        try {
          const font = page.commonObjs.get(id);
          fonts.push({
            type: font?.loadedName ? "resolved" : "unknown",
            type3: !!font?.isType3Font,
          });
        } catch {
          fonts.push({ type: "unresolved", type3: false });
        }
      }
    if (fonts.some((font) => font.type3))
      classification.unsupported.push("type3-font");
    const raster: any[] = [],
      fidelity: any[] = [];
    for (const width of [512, 1024, 2048]) {
      const vp = page.getViewport({ scale: width / viewport.width }),
        canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const t = performance.now();
      await page.render({ canvas: canvas as any, viewport: vp }).promise;
      raster.push({
        viewportWidth: width,
        hostRasterMs: performance.now() - t,
      });
      if (width <= 1024) {
        const prototype = createCanvas(canvas.width, canvas.height),
          ctx = prototype.getContext("2d");
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const t = performance.now();
        replayPaths(
          ctx,
          list,
          names,
          vp.transform,
          glyphPrototype
            ? {
                font: (id) => page.commonObjs.get(id),
                commonObjs: page.commonObjs,
              }
            : undefined,
        );
        const prototypeMs = performance.now() - t;
        fidelity.push({
          viewportWidth: width,
          hostPrototypeMs: prototypeMs,
          ...metrics(
            canvas
              .getContext("2d")
              .getImageData(0, 0, canvas.width, canvas.height).data,
            ctx.getImageData(0, 0, canvas.width, canvas.height).data,
            canvas.width,
            canvas.height,
          ),
        });
        if (reports.length < 4 && width === 1024) {
          await writeFile(
            path.join(
              root,
              "previews",
              `${sample.hash.slice(0, 12)}-reference.png`,
            ),
            canvas.toBuffer("image/png"),
          );
          await writeFile(
            path.join(
              root,
              "previews",
              `${sample.hash.slice(0, 12)}-prototype.png`,
            ),
            prototype.toBuffer("image/png"),
          );
        }
      }
    }
    const scanCandidate =
      classification.imageOperators > 0 &&
      classification.segments < 100 &&
      text.length < 100;
    reports.push({
      hash: sample.hash,
      sourceHash: sample.sourceHash,
      page: sample.page,
      pdfBytes: bytes.length,
      pagePoints: { width: viewport.width, height: viewport.height },
      operatorListMs,
      ...classification,
      textCharacters: text.length,
      tradeHeuristics: trades,
      fontUses: fonts.length,
      scanCandidate,
      raster,
      fidelity,
      completeEncoding: false,
      firstViewEncodingBytes: null,
      fallbackFeatureFlags: [
        ...classification.unsupported,
        ...(scanCandidate ? ["scanned-image-candidate"] : []),
      ],
      prototypeOmissions: [
        ...(classification.textOperators ? ["all-text-glyphs"] : []),
        ...(classification.imageOperators ? ["all-image-resources"] : []),
        "layers",
        "nested-form-matrices",
        "opacity-state",
      ],
    });
    console.log(
      JSON.stringify({
        processed: reports.length,
        sheets: corpus.samples.length,
        hash: sample.hash.slice(0, 12),
      }),
    );
  } catch (error) {
    reports.push({
      hash: sample.hash,
      error: String(error).slice(0, 300),
      stack: (error as Error).stack?.slice(0, 1000),
    });
    console.log(JSON.stringify({ processed: reports.length, error: true }));
  } finally {
    try {
      await loading?.destroy();
    } catch {}
  }
  await writeFile(
    path.join(
      root,
      `measurements-${glyphPrototype ? "glyph-prototype" : (process.env.DRAWING_ONLY_HASH ?? shard)}.json`,
    ),
    JSON.stringify(
      {
        provenance: corpus.provenance,
        hostOnly: true,
        sourceSets: corpus.uniqueSets,
        sheets: reports,
      },
      null,
      2,
    ),
  );
}
