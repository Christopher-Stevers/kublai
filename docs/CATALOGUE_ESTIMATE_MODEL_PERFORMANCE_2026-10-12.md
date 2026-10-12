# Catalogue, estimate and model performance

Three changes reduce work on the browser's main thread without changing workbook contents, estimate arithmetic or triangle intersections. These changes use workers and indexing; no new Rust dependency was needed.

## Catalogue workbooks

Catalogue XLSX/XLS parsing, normalization and XLSX encoding run in a dedicated worker. The UI and worker exchange acknowledged batches of at most 250 rows, and export buffers are transferred rather than copied. SheetJS, the first-sheet import rule, header aliases, the `Parts` export sheet and cell types remain the same. The existing server upload batches remain 50 rows, and a local backup is still downloaded before importing.

Import preparation and export show progress and offer cancellation. Cancel preparation stops before any upload starts. Leaving the catalogue, going offline, losing permission or clearing private account work terminates preparation; leaving the screen or losing access also prevents subsequent upload batches. A server batch already in flight may finish, so this is not a rollback of an import. Export cancellation discards late fetch/worker results. Competing workbook operations are disabled. Unsupported worker environments retain the compatible parser; asynchronous worker failures report an error rather than retrying expensive work on the UI thread.

A synthetic 10,000-row workbook was 4,409,667 bytes. Median local encoding and parsing times were 162 ms and 145 ms. The worker moves that work off the UI thread; these are not claims that SheetJS itself became faster. The normalized result matched the source SHA-256 `3e800a57d77543d81c2ac42224765b0b97ebde1824b8b672e2a8de4fd4707c70`.

## Estimates

One calculation prepares each line's unallocated arithmetic once, then copies it into each base/selected/alternate group. Purchase rounding and cent allocations remain independent for every group. The cache lasts one call, so later edits to quantity, price or settings cannot reuse stale results. Warning lookup is indexed by line ID while preserving the original warning order and independent result arrays.

| Synthetic estimate | Original median | Optimized median |
| --- | ---: | ---: |
| 100 lines, no alternates | 2.59 ms | 1.75 ms |
| 500 lines, 10 alternates | 19.84 ms | 7.69 ms |
| 2,000 lines, 20 alternates | 143.11 ms | 35.66 ms |

Every complete result matched the original calculator's digest. Equivalence tests also cover mixed alternate selections, purchase rounding, margin/markup, missing prices, warnings, duplicate IDs and mutable input. The estimate editor already pages lines in groups of 50; that existing behavior is retained.

## Model selection

Each render batch builds a spatial tree over the actual stored placement transforms and geometry bounds. A ray checks nearby candidates, then Three.js performs the same precise triangle intersection as before. Instance visibility, layers, clipping, hit order and measurement coordinates are retained. The scene removes indexes with their models and clears references on disposal. Placement geometry is static after a batch is loaded; changing camera, visibility or clipping does not require rebuilding the tree.

The memory estimate includes 512 bytes per placement for instance data and the CPU index, up from 256. The existing device budgets remain unchanged and may therefore admit slightly fewer placements. Invalid bounds fall back to the original batch raycast.

| Synthetic placements | Original average pick | Indexed average pick |
| --- | ---: | ---: |
| 1,000 | 0.085 ms | 0.008 ms |
| 10,000 | 0.610 ms | 0.012 ms |
| 50,000 | 2.997 ms | 0.041 ms |

The benchmark uses spatially distributed repeated cubes, 100 placements per render batch and 25 rays. Every hit's instance, point, distance and face matched exactly. Dense overlapping geometry or an individual mesh with many triangles can yield smaller gains. These are local desktop CPU microbenchmarks, not physical-phone or whole-frame timings.

## Reproduction

Run from the repository root:

```sh
node --import tsx scripts/benchmark-catalogue-workbook.ts workbook.json fixture.xlsx
node --import tsx scripts/benchmark-estimate-calculator.ts scan estimate-before.json
node --import tsx scripts/benchmark-estimate-calculator.ts optimized estimate-after.json
node --import tsx scripts/benchmark-model-picker.ts model-picker.json
pnpm exec vitest run src/lib/catalogue-xlsx-core.test.ts src/lib/catalogue-xlsx.test.ts src/lib/catalogue-xlsx.worker.test.ts src/components/catalogue/CatalogueScreen.workbook.test.tsx src/lib/estimating/calculator-equivalence.test.ts src/lib/estimating/calculator.test.ts src/lib/bim/spatial-picker.test.ts src/lib/bim/streaming.test.ts
```

The frozen original calculator under `scripts/benchmarks/scan-calculator.ts` is used only by comparisons and tests. Production imports the optimized calculator.
