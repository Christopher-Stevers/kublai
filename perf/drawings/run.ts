// Host-only spike. Never imports a server mutator or changes uploads.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { classify, replayPaths } from "./operators";
import { collectImageResources } from "./image-resources";
import { validateDrawingInvocation, selectStrokeV3Sample, verifyStrokeV3Bytes, reserveStrokeV3Output, fingerprintStrokeV3Inputs, verifyStrokeV3ReferenceInputs, STROKE_V3_PROTOCOL, STROKE_V3_HASH } from "./stroke-v3-invocation";
import { compareOpaqueRgba, decideHostPrototypeFidelity } from "./fidelity";
import { auditReplaySupport } from "./replay-support";
const root = path.resolve("perf/drawings/private");
const invocation = validateDrawingInvocation(process.env, root);
const strokeV3 = invocation.strokeV3;
const corpusBytes = await readFile(path.join(root, "corpus.json"));
const corpus = JSON.parse(corpusBytes.toString("utf8"));
const sourceInputs = ["perf/drawings/run.ts", "perf/drawings/operators.ts", "perf/drawings/stroke-style.ts", "perf/drawings/image-resources.ts", "perf/drawings/stroke-v3-invocation.ts", "perf/drawings/fidelity.ts", "perf/drawings/replay-support.ts", "package.json", "pnpm-lock.yaml", "node_modules/pdfjs-dist/package.json", "node_modules/pdfjs-dist/legacy/build/pdf.mjs", "node_modules/@napi-rs/canvas/package.json", path.join(root, "corpus.json")];
let strokeV3Bytes: Buffer | undefined;
let strokeV3Sample: {hash:string;file:string} | undefined;
let sourceBefore: Record<string, string> | undefined;
let referenceBinding: {corpusManifestSha256:string;pdfjsReferenceSha256:string} | undefined;
if (strokeV3) {
  strokeV3Sample = selectStrokeV3Sample(corpus.samples as Array<{hash:string;file:string}>);
  strokeV3Bytes = await readFile(strokeV3Sample.file);
  verifyStrokeV3Bytes(strokeV3Bytes);
  sourceBefore = await fingerprintStrokeV3Inputs(sourceInputs);
  referenceBinding = verifyStrokeV3ReferenceInputs(sourceBefore, corpusBytes, root);
  await reserveStrokeV3Output(invocation.output!, root);
  await writeFile(path.join(invocation.output!, "run-start.json"), JSON.stringify({protocol:STROKE_V3_PROTOCOL,fullSampleHash:STROKE_V3_HASH,widths:[512,1024],sourceBefore,referenceBinding,startedAt:new Date().toISOString(),fingerprintLimitations:["Native binaries and transitive font/CMap/WASM dependencies are not exhaustively fingerprinted"],completeEncoding:false,productionChanged:false},null,2),{flag:"wx"});
}
const names = Object.fromEntries(
  Object.entries(OPS).map(([key, value]) => [value, key]),
);
const combinedPrototype = strokeV3 || process.env.DRAWING_COMBINED_PROTOTYPE === "1";
const combinedHash =
  "268d1043b94a91e45a813bd7c62f1ad966a0515045984de3536123c16fb00215";
if (combinedPrototype && process.env.DRAWING_ONLY_HASH !== combinedHash)
  throw Error("Combined prototype requires the exact previously sampled hash");
const imagePrototype =
  combinedPrototype || process.env.DRAWING_IMAGE_PROTOTYPE === "1";
const glyphPrototype =
  combinedPrototype || process.env.DRAWING_GLYPH_PROTOTYPE === "1";
const { shard, shards } = invocation;
const reports: any[] = [];
let prior: any[] = [];
for (const suffix of strokeV3 ? [] : ["0", "1", "2", "3", "eb8da2f0", "7725eb4b"])
  try {
    prior.push(
      ...JSON.parse(
        await readFile(path.join(root, `measurements-${suffix}.json`), "utf8"),
      ).sheets.filter((r: any) => !r.error),
    );
  } catch {}
const previewRoot = strokeV3 ? path.join(invocation.output!, "previews") : path.join(
  root,
  combinedPrototype
    ? "combined-clip-v2-previews"
    : imagePrototype
      ? "image-prototype-previews"
      : "previews",
);
if (!strokeV3) await mkdir(previewRoot, { recursive: true });
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
for (const [sampleIndex, sample] of (strokeV3 ? [strokeV3Sample!] : corpus.samples).entries()) {
  if (sampleIndex % shards !== shard) continue;
  if (glyphPrototype && !combinedPrototype && sampleIndex >= 10) continue;
  const previous = prior.find((r: any) => r.hash === sample.hash);
  if (
    previous &&
    !process.env.DRAWING_ONLY_HASH &&
    !glyphPrototype &&
    !imagePrototype
  ) {
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
    const bytes = strokeV3 ? strokeV3Bytes! : await readFile(sample.file);
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
    const supportAudit = strokeV3 ? auditReplaySupport(list, names, {glyphs:true,images:true,forms:true,strokeStyles:true}) : undefined;
    const images = imagePrototype
      ? collectImageResources(list, names, (id) => page.objs.get(id))
      : undefined;
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
    for (const width of imagePrototype ? [512, 1024] : [512, 1024, 2048]) {
      const vp = page.getViewport({ scale: width / viewport.width }),
        canvas = createCanvas(strokeV3 ? width : Math.ceil(vp.width), Math.ceil(vp.height));
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
        const replay = replayPaths(
          ctx,
          list,
          names,
          vp.transform,
          glyphPrototype || images
            ? {
                images,
                forms: combinedPrototype,
                ...(strokeV3 ? {strokeStyles:true} : {}),
                font: glyphPrototype
                  ? (id: string) => page.commonObjs.get(id)
                  : undefined,
                commonObjs: page.commonObjs,
              }
            : undefined,
        );
        const prototypeMs = performance.now() - t;
        const measured = (strokeV3 ? compareOpaqueRgba : metrics)(
          canvas
            .getContext("2d")
            .getImageData(0, 0, canvas.width, canvas.height).data,
          ctx.getImageData(0, 0, canvas.width, canvas.height).data,
          canvas.width,
          canvas.height,
        );
        fidelity.push({
          viewportWidth: width,
          hostPrototypeMs: prototypeMs,
          replay,
          ...measured,
          ...(strokeV3 ? {comparison:measured} : {}),
          ...(combinedPrototype
            ? {
                replayEligible:
                  replay.failures.length === 0 &&
                  images?.stats.imageReplayEligible === true &&
                  classification.unsupported.length === 0 && (!strokeV3 || supportAudit?.subsetSupported === true),
                passes:
                  measured.passes &&
                  replay.failures.length === 0 &&
                  images?.stats.imageReplayEligible === true &&
                  classification.unsupported.length === 0 && (!strokeV3 || supportAudit?.subsetSupported === true),
              }
            : {}),
        });
        if ((imagePrototype || width === 1024) && reports.length < 4) {
          await writeFile(
            path.join(
              previewRoot,
              `${sample.hash.slice(0, 12)}-${imagePrototype ? `${width}-reference` : "reference"}.png`,
            ),
            canvas.toBuffer("image/png"),
          );
          await writeFile(
            path.join(
              previewRoot,
              `${sample.hash.slice(0, 12)}-${strokeV3 ? `${width}-stroke-v3` : combinedPrototype ? `${width}-combined-clip-v2` : imagePrototype ? `${width}-image-prototype` : "prototype"}.png`,
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
    const strokeV3Omissions = strokeV3 ? [
      ...classification.unsupported,
      ...(scanCandidate ? ["scanned-image-candidate"] : []),
      ...fidelity.flatMap((entry: any) => entry.replay?.failures ?? []),
      ...(classification.textOperators && !glyphPrototype ? ["all-text-glyphs"] : []),
      ...(classification.imageOperators && !images ? ["all-image-resources"] : []),
      ...(images?.stats.failures ?? []),
      ...(supportAudit?.failures ?? ["missing-support-audit"]),
    ] : [];
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
      prototypeProtocol: strokeV3 ? STROKE_V3_PROTOCOL : combinedPrototype
        ? "combined-image-glyph-form-clip-replay-v2-single-existing-sample"
        : imagePrototype
          ? "decoded-image-replay-v1"
          : "historical-path-glyph-replay",
      ...(strokeV3 ? {
        supportAudit,
        hostFidelityDecision: decideHostPrototypeFidelity({
          checks: fidelity.map(entry => ({viewportWidth:entry.viewportWidth,comparison:entry.comparison})),
          supportSucceeded: supportAudit?.subsetSupported === true && !scanCandidate && strokeV3Omissions.length === 0 && fidelity.every(entry => entry.replay.failures.length === 0),
          resourcesSucceeded: images?.stats.imageReplayEligible === true,
        }),
        productionChanged:false,
      } : {}),
      glyphPrototype,
      imageReplay: images?.stats ?? null,
      completeEncoding: false,
      firstViewEncodingBytes: null,
      fallbackFeatureFlags: [
        ...classification.unsupported,
        ...(scanCandidate ? ["scanned-image-candidate"] : []),
      ],
      prototypeOmissions: strokeV3 ? strokeV3Omissions : [
        ...(classification.textOperators && !glyphPrototype
          ? ["all-text-glyphs"]
          : []),
        ...fidelity.flatMap((entry: any) => entry.replay?.failures ?? []),
        ...(classification.imageOperators && !images
          ? ["all-image-resources"]
          : []),
        ...(images?.stats.failures ?? []),
        "layers",
        ...(!combinedPrototype ? ["nested-form-matrices"] : []),
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
    if (strokeV3) process.exitCode = 1;
    reports.push({
      hash: sample.hash,
      error: String(error).slice(0, 300),
      stack: (error as Error).stack?.slice(0, 1000),
    });
    console.log(JSON.stringify({ processed: reports.length, error: true }));
  } finally {
    try {
      await loading?.destroy();
    } catch (error) {
      if (strokeV3) { process.exitCode = 1; reports[reports.length-1].cleanupError = String(error).slice(0,300); }
    }
  }
  let sourceAfter: Record<string,string> | undefined;
  let sourceAfterError: string | undefined;
  if (strokeV3) {
    try { sourceAfter = await fingerprintStrokeV3Inputs(sourceInputs); }
    catch (error) { sourceAfterError = String(error).slice(0,300); }
  }
  const sourceUnchanged = strokeV3 ? !sourceAfterError && JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter) : undefined;
  const hostPrototypePass = strokeV3 && reports.length===1 && !reports[0]?.error && !reports[0]?.cleanupError && sourceUnchanged===true && reports[0]?.hostFidelityDecision?.hostPrototypePass===true;
  if (strokeV3 && !hostPrototypePass) process.exitCode = 1;
  await writeFile(
    strokeV3 ? path.join(invocation.output!, "result.json") : path.join(
      root,
      `measurements-${combinedPrototype ? `combined-clip-v2-${combinedHash}` : imagePrototype ? `image-prototype-${process.env.DRAWING_ONLY_HASH ?? shard}` : glyphPrototype ? "glyph-prototype" : (process.env.DRAWING_ONLY_HASH ?? shard)}.json`,
    ),
    JSON.stringify(
      {
        provenance: corpus.provenance,
        hostOnly: true,
        ...(strokeV3 ? {protocol:STROKE_V3_PROTOCOL,fullSampleHash:combinedHash,widths:[512,1024],sourceBefore,sourceAfter,referenceBinding,sourceUnchanged,hostPrototypePass,sourceAfterError,fingerprintLimitations:["Native binaries and transitive font/CMap/WASM dependencies are not exhaustively fingerprinted"],productionEligible:false,completeEncoding:false,productionChanged:false} : {}),
        sourceSets: corpus.uniqueSets,
        sheets: reports,
      },
      null,
      2,
    ),
    strokeV3 ? {flag:"wx"} : undefined,
  );
}
