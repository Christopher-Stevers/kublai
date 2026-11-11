# Material-list CPU diagnostic attempt 5 — latched first-control readiness

**Two completed supplemental profiles; no acceptance-gate change or pass.** Root reviewed this instrumentation correction after v4's repeated all-control geometry traversal obscured the app. Prior raw protocols/results remain unchanged.

V5 first asserts the exact source pathname, unique visible source target and zero Increase controls (including hidden ones) outside capture. The observer requires the exact destination pathname, queries only the first exact Increase button, checks connected/CSS visibility/one positive bounding rect, marks ready and disconnects. No extra microtask delay or force-click. The original default-click locator, Playwright first-control visible assertion and two-rAF completion remain; all 24-control counting is in finish after CPU/trace stop. A real Chromium fixture passed wrong-route, hidden-first, unmounted, single geometry-read/latch/disconnect checks before capture. It is synthetic tooling evidence, not a phone/app timing pass.

Both fresh private apps passed 14-query preflight, exact source/process/privateDB checks, and post-capture source validation. V4's reviewed synthetic bootstrap exceptions are unchanged; zero guard rejections. Driver/helper/dependencies/launcher were sealed before setup; config was hashed/sealed before GO; all before/after hashes match. Capture including preparations ran 11:09:41.519–11:10:24.561UTC 2026-11-11, under the 8 minute outer bound. Both profile intervals and raw file sizes are within their caps.

| Trace interval (one/source) | Phase0 | R6 |
| --- | ---: | ---: |
| Pointerdown mark→click mark |1.259ms |7.995ms |
| Click mark→first-control ready mark |108.310ms |117.024ms |
| Largest same React-runtime FunctionCall |56.354ms |64.849ms |
| Readiness observer FunctionCall |8.254ms |7.753ms |
| Post-trace visible Increase count |24 |24 |

Raw `performance.now()` event records are retained separately; marks run slightly later and their intervals differ. Lower observer overhead than v4 is a **diagnostic protocol change**, not app improvement. It exposes an additional R6 React-runtime callback region in this one sample. Inclusive sampled module weights overlap: React 75.890/87.032ms; Button 2.946/5.191ms; material-row 1.682/3.576ms; R6 receipt-containing module 6.480ms and press-containing module 1.584ms. Code-containing modules can contain multiple functions: these are not exclusive receipt/press costs or measured effect invocations. 24 ordinary quantity rows corroborate 48 quantity buttons; source-predicted effect registration counts remain hypotheses about fanout. Native/automation/IDB frames remain in raw/grouped evidence; minified samples do not isolate each component's render versus commit or asynchronous waiting.

`analysis.json` groups clipped sample weights by phase/script/webpack module/callframe. Raw negative deltas are retained; post-capture analysis sorts accumulated sample timestamps for nonoverlapping descriptive intervals. `analysis.mjs` was generated after capture, not part of the frozen executed timing driver. Original raw profiles are unchanged and the offline summary reproduces exactly. No significance, product improvement, causal attribution or failed-gate waiver follows from N=1/source.

Both apps/private PG directories were removed, PG ERROR reports empty, ports 3482/3483 closed and quiet released. No declared heavy agent work/ADB overlapped, but OS/production services remained running. No app build/source change, deployment, phone or production write occurred. `sha256sums.txt` binds raw evidence and provenance.
