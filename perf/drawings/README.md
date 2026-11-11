# Drawing vector spike — isolated, no rollout

The approved sample is read directly from local production upload storage, confirmed by a read-only database transaction. No source PDF, title text, drawing geometry, source path or account data is committed. `private/` is ignored; its PDFs and render previews stay on this machine. Sampling uses 100 distinct `(source, page)` slots across 50 DB-referenced originals and removes byte-identical original PDFs. PDF hashes alone are insufficient to detect repeat extracts because qpdf can change document IDs.

This is the TypeScript/pdf.js front-end spike in SPEED_PLAN section 11. It changes no production render, sync, worker, database or upload path. Rust was already installed; no compiler port or new dependency was installed.

## Reproduce

From the repository root:

```sh
node --env-file=.env perf/drawings/sample.mjs
node perf/drawings/corpus.mjs
npx tsx perf/drawings/run.ts
npx tsx perf/drawings/resources.ts
node perf/drawings/resource-streams.mjs
DRAWING_GLYPH_PROTOTYPE=1 npx tsx perf/drawings/run.ts
node perf/drawings/summarize.mjs
npx vitest run --config perf/drawings/vitest.config.ts
```

`sample.mjs` reads only DB metadata and readable local originals. The DB URL is consumed through environment variables and never logged. `corpus.mjs` writes page extracts only in `private/pages/`; it never invokes the production page splitter or writes to uploads. The round-robin sample spans first, middle and last pages, then additional distinct pages. Trades are inferred from text keywords, not trusted labels. Spools and small detail sheets occur in the current upload population; this is not a balanced industry corpus. Scan, hatch, transparency and font diversity require reviewed annotations before claiming representativeness.

The run can be sharded with `DRAWING_SHARDS=4 DRAWING_SHARD=0` through `3`, separately for `run.ts` and `resources.ts`. Shards reuse exact-hash completed measurements. The committed summary requires all 100 actual unique source/page slots and complete measurements; it rejects a partial sample. Host timings collected concurrently are workload observations, not uncontended CPU benchmarks or phone evidence.

## What is implemented

- pdf.js 6 packed path parsing; operators, paths, subpaths, segments and curves; text, image and clip distributions.
- Explicit gradient/shading, pattern color, soft mask, blend mode and Type 3 font feature flags. These are fallback categories in the proposed design, not production fallback marks.
- Shared used-glyph outline extraction and resource byte accounting. Original encoded image/font streams are measured with qpdf without decoding or uploading source content.
- Affine-normalized spatial path buckets with containing ancestor tiles for paths that cross a boundary, a 13 bit grid, delta varints and identical mesh deduplication. Coarse geometry drops only sub-third-pixel bounding boxes at a 512px first view; it does not implement dense hatch merging or a validated LOD.
- A small canvas path replay and an optional shared outline glyph placement prototype. Both are deliberately incomplete; images, general font behavior, layers, opacity and nested form handling are not a production renderer.
- Host pdf.js raster timings at 512/1024/2048px width. At two widths the prototype is compared using 64px luminance SSIM tiles and total ink coverage difference. This catches obvious missing content, not the full required safety review.

The byte report distinguishes partial geometry/glyph/image components from a complete immutable indexed package. Glyph outlines are measured resources; images use their original compressed streams for accounting. Styles, clipping, resource dictionaries, layer IDs, triangulation and the tile index still need an encoding. A whole-PDF sidecar provides a conservative transport fallback size, not evidence of vector compression. None of these partial numbers satisfies the full-detail or first-view gate.

## Physical phone harness

```sh
node perf/drawings/serve.mjs
adb reverse tcp:3494 tcp:3494
```

On an authorized USB-connected reference phone, open `http://127.0.0.1:3494`, keep it foregrounded, run the sample, and download its report. The server binds only loopback, exposes only allowlisted corpus hashes and pdf.js runtime assets, and makes no external requests. The harness measures three raster widths; it does not assert hardware identity, repeatability, a GPU frame gate or a production app journey.

The existing `perf/budgets.json` and `perf/run.mjs` define the shared link/CPU methodology. The full-app runner intentionally accepts only an isolated seeded app and blocks production-data fallbacks, so it must not be pointed at these private production drawings. Real network/phone evidence must be collected separately and labeled honestly. No fabricated phone, Safari, WebGL2 or netperf result is included here.

## Decision and remaining proof

All four spike go gates remain **UNPROVEN** until a complete resource-aware compiler/render path exists, at least 85% of sheets compile with no unsupported feature, full-detail median is at most 610 KB (and compared with this sample's measured PDF median), first-view median is at most 150 KB, and a dense sheet draws below 8 ms on the physical reference phone. The existing path-only comparison failing because it omits text/images does not justify stopping the architecture. It does prohibit rollout.

Before a production Rust port: finish glyph/text semantics, image resources, styles/clips/layers and a decodable indexed tile format; compare those bytes; implement WebGL2; run per-tile fidelity at two zooms, ink difference ≤0.005, and human review of 50 sheets; collect physical-phone raster and GPU frame timings. Permanently keep gradients, tiling patterns, soft masks, blend modes, Type 3 fonts, scans and fidelity failures on the existing path as the plan specifies. In this spike those classifications only generate report flags and never modify production manifests.

Rollback is deleting/reverting `perf/drawings/`; no app setting or production rendering path needs restoration. Private sample outputs can be removed independently after the study.
