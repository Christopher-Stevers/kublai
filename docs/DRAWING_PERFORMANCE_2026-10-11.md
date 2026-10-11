# Drawing interaction and background-work performance

Date: 2026-10-11. Continues the deployed PDF zoom/pan pass in `PDF_ZOOM_PAN_PERFORMANCE_2026-10-11.md`.

## Changes

- Live pen, move, and resize previews publish once per animation frame. Input samples remain separate from painting; release commits the exact final geometry synchronously. Coalesced stylus input is retained. Cancellation, source changes, stale revisions, and permission changes prevent queued previews from reappearing.
- Workspace annotation arrays, selection/link callbacks, and tile requests remain stable during unrelated tool-panel updates. Entity/queued-edit lookups use maps and sets instead of repeated scans. The empty offline queue retains a stable identity.
- Adjacent sheets prefetch their workspace data after a brief idle delay. Focused/hovered sheet entries prefetch as well. Normal opening still revalidates the workspace, and account changes cancel and remove drawing queries.
- Measurement snap-index construction and pipe graph construction/selection run in dedicated workers. CAD input transfers in acknowledged batches of 2,000 segments; transferring one giant object was itself a UI bottleneck. The worker retains the graph and connection caches between taps. Out-of-order tap/filter responses cannot affect the current sheet.
- Marked PDF downloads and print preparation use a background worker with the same vector builder. PDF sources and link destinations are resolved in the current account before transfer. Plain original downloads avoid loading the PDF builder. International and multiline notes retain the existing browser font/canvas fallback.
- Export downloads enforce byte limits while reading a stream, including responses without a usable Content-Length. Account changes and cancellation terminate private geometry/export work.

## Measurements

Synthetic Chromium harness, mobile viewport 390×844 at DPR 3, fourfold main-thread CPU throttling. Editing uses 480 input samples across 60 display frames; three trials per case. These are controlled browser tests, not measurements on Tim's phone.

| Operation | Before | After |
| --- | ---: | ---: |
| Drag 3,800-point markup: median React commits | 444 | 61 |
| Drag: median React rendering time | 1,990 ms | 307 ms |
| Drag: 95th-percentile frame interval | 83.3 ms | 16.8 ms |
| Drag: frames over 50 ms | 29–34 | 0 |
| Pen: median preview commits | 421 | 61 |
| 80,000-line snap build: largest frame interval | 66.7 ms | 16.8 ms |
| 80,000-line pipe build/selection: largest frame interval | 150 ms | 16.8 ms |
| Two-sheet marked PDF package: preparation | 623 ms | 209 ms |
| Package: largest frame interval | 600 ms | 16.7 ms |

Geometry workers improve UI responsiveness; pipe completion itself was about 166 ms before versus 180 ms after in this case. Worker CPU is not slowed by Chromium's main-thread throttle, so export completion ratios should not be generalized to a physical phone. Prefetch eliminates the empty workspace wait when data arrives before navigation; network savings were not timed.

Raw local results and harness: `.tmp/drawing-fast-pass/benchmark.json`, `export-benchmark.json`, and `harness/`. The release's actual Webpack worker bundles were also executed by the synthetic harness (`production-worker-checks.json`).

## Correctness and release checks

- 473 focused drawing/editor/PDF/geometry/queue tests passed, including the export tests. A dedicated 30-test export/download check also passed.
- Original and worker exports produced identical page-pixel hashes, extracted text, link targets, and page counts for a 12,000-line vector sheet and a rotated crop with UserUnit. Cases include single-sheet and two-sheet packages with 200 markups and 50 links.
- Snap and pipe result hashes matched their previous implementations on 80,000-line fixtures. Preview and saved paths retained their points and endpoints.
- TypeScript and focused production-source ESLint passed. The frozen Next.js production build passed.
- All six production-worker checks passed with no browser or network errors.

PDF display retains the existing sharp, bounded original-PDF renderer and front canvas. This pass does not replace PDF.js fonts, image decoding, page transforms, or the room-detection algorithm. Initial download/decode time and the resolution of scanned originals still depend on the source and device.
