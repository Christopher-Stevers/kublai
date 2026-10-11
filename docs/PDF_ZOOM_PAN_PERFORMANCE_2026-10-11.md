# Drawing zoom and pan performance — 2026-10-11

The user identified zooming and panning on a phone as the slow PDF/markup action.
This release reduces repeat rendering work; it keeps the existing viewer, saved
markup geometry, original PDF resolution, bounded canvases, and editing behavior.
It builds on the earlier Rust room-raster worker without replacing the browser
viewer in Rust. React reconciliation and avoidable PDF commands were measurable
costs here.

## Changes

- Saved annotation bodies and items are memoized. Ordinary ink stays in sheet
  coordinates and does not rebuild on zoom; pins, measurement runs and selection
  handles still keep their screen size. Only edited data invalidates its shape.
- The viewer retains a stable visible annotation list during movement. Pan
  commits can reuse the entire annotation layer.
- Successful whole-page PDF detail renders record conservative operation bounds
  using the installed PDF.js 6.2.108 API. Later crops skip offscreen operations,
  with the same intersection rule as PDF.js's own optimized detail viewer.
- A WeakMap trusts only completed whole-page recordings. Canceled or failed
  recordings are never used for filtering. Opening directly into a zoomed crop
  uses the original full operator-list rendering until a whole-page view exists.
- Existing sharp front-buffer pixels remain visible through motion and failures.
  Canvas pixel budgets, byte-range loading and authentication are unchanged.

## Measurements

Local production profiling bundles used the actual viewer and synthetic saved
markups in Chromium 152, viewport 390×844, DPR 3, with 4× CPU throttling. Three
trials used 120-frame wheel zoom and touch pan sequences. Values are medians.
These are emulated workloads, not measurements from the user's actual phone.

| Workload | Before: React render work | After | Before: frame interval p95 | After |
| --- | ---: | ---: | ---: | ---: |
| 200 markups, zoom | 562 ms | 21 ms | 16.7 ms | 16.8 ms |
| 200 markups, pan | 657 ms | 15 ms | 16.7 ms | 16.7 ms |
| 800 markups, zoom | 4,127 ms | 32 ms | 66.7 ms | 16.7 ms |
| 800 markups, pan | 4,346 ms | 16 ms | 66.7 ms | 16.8 ms |

The 800-markup trials went from a median 45/47 frames above 50 ms during zoom/pan
to zero. Render totals include settling/momentum; the baseline slowdowns also
lengthened gestures, so these totals are not a fixed-duration microbenchmark.

With a synthetic 12,000-line PDF and 200 markups opened at fit, zoom p95 improved
from 66.7 to 50 ms; some PDF frames still exceed the normal refresh interval.
Pan p95 in that particular PDF trial varied from 16.8 to 33.4 ms, so this study
does not claim universal frame-rate improvements. A separate final-build check
observed a visible sharp canvas in every one of 120 zoom and 120 pan frames and
reported no browser errors.

Read-only native-canvas tests used three existing local PDFs (SHA-256 receipts
only; private files are not committed). Two single-sheet CAD drawings were tested
at three regions, with three full/filtered repeats each. The selected crops
rendered 4–14× faster and every RGBA pixel matched the unfiltered crop. The larger
14-page PDF's first page also passed a bounded crop comparison. Its unfiltered
crop spent about 15.6 seconds on offscreen content versus about 5 ms filtered;
this exceptional crop is not a general speedup claim. Native timings do not
predict actual phone latency. Complex images/fonts and initial page decoding can
still take time.

## Validation and reproduction

- 182 focused viewer, annotation, gesture, export and viewport tests passed.
- Eight real PDF.js/native-canvas fixture comparisons passed across all four
  rotations and two vertical scales, exercising scoped state and offscreen ink.
- Three existing PDFs passed full-versus-filtered crop pixel comparisons.
- TypeScript, focused ESLint and an isolated production build passed.
- Local browser measurements and deployment receipts remain under
  `.tmp/pdf-markup-performance/`.

Run the read-only crop check with:

```sh
pnpm exec tsx scripts/benchmark-drawing-pdf-crops.ts /tmp/crop-report.json /path/to/drawing.pdf
```

The existing PDF document cache limits documents to two and clears on account
changes. Operation bounds follow page lifetime and are not an additional private
file cache. Roll back by restoring the previous `.next` release symlink and
restarting `foremenhq.service`.
