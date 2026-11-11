import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const root = path.resolve("perf/drawings"),
  privateRoot = path.join(root, "private");
const corpus = JSON.parse(
  await readFile(path.join(privateRoot, "corpus.json"), "utf8"),
);
async function collect(prefix) {
  const map = new Map();
  for (const suffix of ["0", "1", "2", "3", "eb8da2f0", "7725eb4b"])
    try {
      const file = JSON.parse(
        await readFile(
          path.join(privateRoot, `${prefix}-${suffix}.json`),
          "utf8",
        ),
      );
      for (const row of file.sheets ?? file)
        if (!row.error) map.set(row.hash, row);
    } catch {}
  return corpus.samples.map((s) => map.get(s.hash)).filter(Boolean);
}
const measured = await collect("measurements"),
  resources = await collect("resources"),
  streams = JSON.parse(
    await readFile(path.join(privateRoot, "resource-streams.json"), "utf8"),
  );
if (
  measured.length !== 100 ||
  resources.length !== 100 ||
  new Set(corpus.samples.map((s) => `${s.sourceHash}:${s.page}`)).size !== 100
)
  throw Error(
    `Incomplete unique corpus: ${measured.length} measurements, ${resources.length} resources`,
  );
const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b),
    m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
};
const range = (values) => ({
  min: Math.min(...values),
  median: median(values),
  max: Math.max(...values),
});
const categories = {},
  trades = {},
  operators = {};
for (const sheet of measured) {
  for (const feature of sheet.unsupported ?? [])
    categories[feature] = (categories[feature] ?? 0) + 1;
  for (const trade of sheet.tradeHeuristics ?? [])
    trades[trade] = (trades[trade] ?? 0) + 1;
  for (const [operator, count] of Object.entries(sheet.counts ?? {}))
    operators[operator] = (operators[operator] ?? 0) + count;
}
let glyphPrototype;
try {
  glyphPrototype = JSON.parse(
    await readFile(
      path.join(privateRoot, "measurements-glyph-prototype.json"),
      "utf8",
    ),
  ).sheets;
} catch {}
const byHash = new Map(streams.map((r) => [r.hash, r]));
const report = {
  version: 1,
  date: "2026-11-10",
  provenance: corpus.provenance,
  host: {
    node: process.version,
    platform: os.platform(),
    cpu: os.cpus()[0]?.model,
    concurrentBenchmarkProcesses: true,
  },
  sample: {
    sheets: 100,
    distinctSourcePageSlots: 100,
    sourceSets: new Set(corpus.samples.map((s) => s.sourceHash)).size,
    selection:
      "Round-robin first/middle/last, then consecutive distinct pages across DB-referenced originals; byte-identical source PDFs removed. Trade labels are keyword heuristics, not reviewed annotations; scan/hatch/font diversity not a certified representative distribution.",
  },
  pdfBytes: range(corpus.samples.map((s) => s.pdfBytes)),
  operators,
  paths: range(measured.map((s) => s.paths)),
  segments: range(measured.map((s) => s.segments)),
  curves: range(measured.map((s) => s.curves)),
  featureCoverage: {
    sheetsWithText: measured.filter((s) => s.textOperators).length,
    sheetsWithImages: measured.filter((s) => s.imageOperators).length,
    sheetsWithClips: measured.filter((s) => s.clips).length,
    scanCandidatesUnreviewed: measured.filter((s) => s.scanCandidate).length,
    explicitUnsupportedFeatureSheets: measured.filter(
      (s) => s.unsupported?.length,
    ).length,
    unsupportedCategories: categories,
    tradeKeywordHeuristics: trades,
  },
  resourceAccounting: {
    glyphOutlines: resources.reduce((n, r) => n + r.uniqueGlyphOutlines, 0),
    unresolvedGlyphOutlines: resources.reduce(
      (n, r) => n + r.unresolvedGlyphOutlines,
      0,
    ),
    glyphBrotliBytes: range(resources.map((r) => r.glyphOutlineBrotliBytes)),
    geometryBrotliBytes: range(
      resources.map((r) => r.spatial.geometryBrotliBytes),
    ),
    coarseGeometryBrotliBytes: range(
      resources.map((r) => r.spatial.coarseGeometryBrotliBytes),
    ),
    originalEncodedImageStreamBytes: range(
      resources.map(
        (r) => byHash.get(r.hash)?.originalEncodedImageStreamBytes ?? 0,
      ),
    ),
    partialGeometryGlyphImageComponentBytes: range(
      resources.map(
        (r) =>
          r.spatial.geometryBrotliBytes +
          r.glyphOutlineBrotliBytes +
          (byHash.get(r.hash)?.originalEncodedImageStreamBytes ?? 0),
      ),
    ),
    wholePdfSidecarTransportBytes: range(
      resources.map((r) => r.wholePdfSidecarTransportUpperBoundBytes),
    ),
    note: "Components are measured, not a complete compiled encoding. Styles, clips, layers, full resource dictionaries, triangulation, tile index/placement and render validation are unfinished. Coarse bbox culling is not an approved first-view LOD. PDF sidecar transport retains the entire original as a conservative fallback, not a vector size win.",
  },
  hostRasterByWidth: Object.fromEntries(
    [512, 1024, 2048].map((width) => [
      width,
      range(
        measured.flatMap((s) =>
          s.raster
            .filter((r) => r.viewportWidth === width)
            .map((r) => r.hostRasterMs),
        ),
      ),
    ]),
  ),
  fidelity: {
    pathOnlySheets: measured.length,
    pathOnlyAllTilesPass: measured.filter((s) =>
      s.fidelity.every((f) => f.passes),
    ).length,
    glyphPrototypeSheets: glyphPrototype?.length ?? 0,
    glyphPrototypeAllTilesPass:
      glyphPrototype?.filter(
        (s) => !s.error && s.fidelity.every((f) => f.passes),
      ).length ?? 0,
    note: "64px luminance SSIM tiles, two raster widths, ink threshold 0.005. Limited prototype intentionally omits images/patterns/layers/opacity/forms; failures are prototype gaps, not evidence the proposed architecture cannot work. Manual review only inspected a reference/prototype pair.",
  },
  gates: {
    compile85Percent:
      "UNPROVEN: parser feature eligibility is not successful compilation",
    fullSizeMedian610KB:
      "UNPROVEN: only partial resource-aware encodings measured",
    firstViewMedian150KB: "UNPROVEN: no fidelity-approved complete LOD package",
    denseSheetGPU8ms:
      "UNPROVEN: no WebGL2 renderer or physical-phone frame measurement",
    phoneRasterThreeZooms:
      "UNPROVEN: runnable local phone harness provided, no physical-phone result",
    decision:
      "Do not enable vector rendering or begin a production Rust port on this evidence. Continue the isolated compiler/renderer spike; no architecture stop is justified by omitted prototype features.",
  },
};
await writeFile(
  path.join(root, "spike-report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    sheets: 100,
    sourceSets: report.sample.sourceSets,
    pdfMedian: report.pdfBytes.median,
    unsupportedSheets: report.featureCoverage.explicitUnsupportedFeatureSheets,
    decision: "UNPROVEN",
  }),
);
