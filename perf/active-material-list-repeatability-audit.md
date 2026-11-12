# Active-source Office material-list repeatability audit

Source/raw inspection only; no new runtime. Fixed first report and rejected repeat remain unchanged. Commit37d8aac4 retains all120 repeat samples and both validators. The active-source pair failed the unchanged10% threshold; no accepted replacement or waiver is proposed.

| Capture | Run | Outer ms | Browser mark ms | Descriptive difference ms |
|---|---:|---:|---:|---:|
| fixed-first | 1 | 204.495540 | 153.000000 | 51.495540 |
| fixed-first | 2 | 203.792925 | 152.200000 | 51.592925 |
| fixed-first | 3 | 262.171090 | 192.000000 | 70.171090 |
| fixed-first | 4 | 233.111241 | 158.700000 | 74.411241 |
| fixed-first | 5 | 205.817057 | 154.800000 | 51.017057 |
| independent-repeat | 1 | 232.029312 | 157.200000 | 74.829312 |
| independent-repeat | 2 | 233.014921 | 157.700000 | 75.314921 |
| independent-repeat | 3 | 230.837922 | 158.000000 | 72.837922 |
| independent-repeat | 4 | 233.597521 | 160.800000 | 72.797521 |
| independent-repeat | 5 | 220.115833 | 168.400000 | 51.715833 |

The paired differences are descriptive arithmetic, not identified overhead or a corrected gate. Median outer205.817057→232.029312ms (+12.74%); browser mark154.800000→158ms (+2.07%); median paired difference51.592925→72.837922ms. The measures have different origins and completion conditions, so subtraction cannot isolate app/driver time or establish causality.

## Exact boundaries

`f9/perf/run.mjs:249–255` starts Node performance.now immediately before the original adapter and stops after it resolves. `journeys.mjs:129–139` invokes default getByText(materialListName,{exact:true}).first().click(), awaits first exact Increase quantity button visibility, then page.evaluate with two nested requestAnimationFrame callbacks. Outer time includes actionability/stability/scroll/hit testing, trusted dispatch, navigation waits, assertion scheduling, browser/driver messaging and final paint opportunity.

`SpeedTelemetry.tsx:18–70` starts its browser measurement from a capture-phase pointerdown observer. A pathname-change passive effect waits until no visible route/startup-loading elements remain, then two rAF callbacks end the measure. This starts after pre-input actionability and does not assert the Increase button. Its independent two-rAF chain need not coincide with the adapter’s later two-rAF chain. Neither establishes physical paint or same-frame behavior.

Visited preparation (`journeys.mjs:39–108`) goes to job material-list index, opens the destination through the same adapter, goes back, verifies source URL/list-name and performs two rAF. Each timed run uses a fresh browser context (`run.mjs:168–180`), so client state is warmed inside that sample, not inherited from the prior sample. The original preparation does not explicitly assert destination controls absent after returning; a future supplemental guard must verify this without changing frozen acceptance reports.

Installed Playwright1.59.1 frames.js:1158–1176 performs an immediate assertion check followed by100/250/500/1000ms polling if needed; dom.js:320–397 requires visible/enabled/stable and waits navigation signals for a normal click. This proves possible phases, not which phase occurred in these captures. No force click is proposed.

## What existing evidence cannot resolve

The two raw reports preserve duration-only browser measures, not their absolute startTime/timeOrigin, per-operation action/assertion/rAF timestamps or network/Replicache transactions. PERF_DIAGNOSTICS=0 was explicit. Both whole captures report14read preflight success, zeroPGERROR/FATAL, identical jobs idle80procedure count and one stream, but those aggregate observations cannot attribute traffic to this timed Office cell. Material Replicache source retains60s pull cadence, catalogue5min; no per-click evidence establishes a pull, subscription render or background-request cause. Browsermark similarity supports investigating different timing boundaries, not claiming the app had no regression or blaming Playwright.

## Proposed bounded supplemental timeline (not authorized/executed)

One same-source session against retained fxHxrn/wTBA, source9aae/34f, fresh privatePG and original14read preflight. Exactly ten Office/openmateriallist operations in two predeclared blocks of five; fresh context, exact frozen prepare and adapter/default locator each time. Preserve every failure; no fullmatrix, comparator swap, timing subtraction or acceptance-method change. No rebuild.

Use Playwright context tracing without screenshots/snapshots/sources to retain actual click/assert/page.evaluate API start/end and call logs; verify installed trace event shape with no-app fixtures before approval. Add bounded passive trusted pointerdown/up/click and EventTiming/LongTask observers with takeRecords drainage; preserve event.timeStamp, performance.now/timeOrigin and Node anchors as separate clocks. Capture CDP devtools.timeline +blink.user_timing for discrete RequestAnimationFrame/FireAnimationFrame, EventDispatch, FunctionCall and Layout/UpdateLayoutTree initiators. No CPU sampling (avoids prior negative-delta attribution), continuous rAF loop, broad DOM observer or prototype/geometry patch.

If exact DOM-ready timing is needed, one minimal observer checks only the first exact Increase button after exact destination pathname, at most one visibility read before latch/disconnect; no all-controls traversal. Assert source has no Increase controls before capture; count all24 outside captured interval. This observer perturbs the page and must be qualified, not treated as acceptance evidence.

Record actual same-origin tRPC/Replicache request start/end/procedure/status around action using bounded event records, no extra requests/bodies/production traffic. A request overlap is correlation, not transaction/render causality. Keep raw trace clocks unchanged and report clock mapping explicitly. At most3s captured action per operation,≤60MiB trace total,180s driver and8min outer setup/cleanup; reuse reviewed quota/PG/source/process cleanup guards. Stop on first source/precondition/security/size/capture failure; preserve partials and no automatic retry. Root review required before implementation/execution.
