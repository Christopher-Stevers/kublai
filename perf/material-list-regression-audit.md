# Material-list regression source audit

Read-only audit, 2026-11-11. No application change, new trace, timing run, threshold change or causal conclusion. The full R7 result remains failed; this audit does not replace its gate.

## Sealed sources

Compared `/home/tim/.openclaw/workspace/releases/` snapshots:

| Snapshot | Directory | Source build | Source fingerprint |
| --- | --- | --- | --- |
| Phase0 | `speed-phase0-bootstrap-20261110` | `c25f525d3a4755145e22b9977b300607209034ff59196ee170cbe219cf2c2e5d` | `128da6e7cd4b35dce132d543a56ed673f8dce30fae56f7456b1fc3d94f5e8dd2` |
| R6 | `speed-phase1-reviewed-r6-20261111` | `c49e8cbad84665aadc57323448c013f7c2420fa9cdff3992835164913bb7f161` | `3d4e7376001274a418390701935b8f474d6973a6ae4f8976ede74fd62e7c1c0d` |
| R7 | `speed-phase1-reviewed-r7-20261111` | `754be902243877741d07e73a3fd492261afaf7dc0a3cdf07e859a85c9ad5b2d4` | `42fcc8c7a84d3cb7a243e6f2ca393abffc76d1181df0dbe84d33b926ff1b5efa` |

File SHA-256 prefixes (12 hex characters):

| Path | Phase0 | R6 | R7 |
| --- | --- | --- | --- |
| `src/components/materialLists/JobMaterialListsView.tsx` | `42d4da14d9d3` | `b91cd70bf9c5` | `b91cd70bf9c5` |
| `src/components/materialLists/MaterialListScreen.tsx` | `af9f991360e1` | `78a5d99d4651` | `78a5d99d4651` |
| `src/components/materialLists/MaterialListCard.tsx` | `4bfd0c70acd4` | `23bc5a0eeef0` | `23bc5a0eeef0` |
| `src/hooks/use-replicache-material-list.ts` | `3d93560269fb` | `3d93560269fb` | `3d93560269fb` |
| `src/trpc/react.tsx` | `9d5ce45596d5` | `ad00046911b9` | `ad00046911b9` |
| `src/trpc/query-client.ts` | `eeb1e1c66942` | `4e3feddd4760` | `4e3feddd4760` |
| `src/app/jobs/JobsClient.tsx` | `72ef6fb0da35` | `8121971ac79c` | `8121971ac79c` |
| `src/components/jobs/DrawingAccountProvider.tsx` | `bdf079ba9d46` | `4dd05812a1ad` | `b7a07f7c1369` |
| `src/lib/device-query-cache.ts` | absent | `b858025a7f74` | `e9c2ec1f193e` |
| `src/components/jobs/JobActivityPanels.tsx` | absent | `2837871dd4d4` | `2ded6b27d074` |

## Actual route and work

The sealed journey starts at `/jobs/{jobId}/material-lists`. That route's `page.tsx` renders `JobMaterialListsView`, whose card prepares `openmateriallist` and invokes `onOpen`. The route callback calls `router.push('/jobs/material-lists/{id}')`. `src/app/jobs/material-lists/[id]/page.tsx` then renders `MaterialListScreen` with the selected ID. The timed readiness locator is the first visible `Increase quantity` button, followed by two animation frames.

The registry's preparation imports the screen and reads the existing Replicache `materialList/{id}` plus `itemsByList` records. The screen reads `useReplicacheMaterialList`, suppliers, sorting and pricing. Its order/notes queries require modal IDs and are disabled during an ordinary list opening. This direct route does not render the JobsClient `JobActivityPanels` host; the R7 equality bailout is not active work on this route.

The principal material-list files, Replicache reader and query provider/configuration are identical R6→R7. Phase0→R6 introduced press/preparation and other screen changes; these remain possible contributors to the already-present browser-stage increase, not proven causes. The query defaults changed from 30-second staleness to five minutes/24-hour garbage collection before R7.

R7's shared `DrawingAccountProvider` addition exposes the already-validated organization ID. It adds no request/subscription, and the existing account key already varies with organization. The device-query-cache change recognizes terminal `drawingsWorkspace.openDocument` mutation errors; it does not add a healthy material-list refresh path. Saved-view/document work is not mounted as the material-list screen. Shared bundle loading/registration effects have not been profiled and cannot be excluded from source inspection alone. Later internal navigation telemetry (`9509b4fc`) is excluded from sealed R7.

## Raw evidence

Inputs under `perf/artifacts/`:

- `baseline-ready-then-pinch-v2-rerun-2026-11-11-1.json`
- `baseline-ready-then-pinch-v2-rerun-2026-11-11-2.json`
- `candidate-r6-ready-then-pinch-v2-2026-11-11-report.json`
- `candidate-r7-ready-then-pinch-v2-2026-11-11-report.json`
- `candidate-r7-ready-then-pinch-v2-2026-11-11-assessment.json`

Medians for `openmateriallist`, milliseconds; each cell has five samples. Browser values are the existing app `tap-to-paint` measures, a different stage proxy from driver duration.

| Link | Phase0 capture 1 driver/browser | Phase0 capture 2 driver/browser | R6 driver/browser | R7 driver/browser |
| --- | --- | --- | --- | --- |
| Basement | 215.1 / 159.2 | 216.5 / 159.8 | 224.1 / 172.1 | 244.7 / 176.2 |
| Site | 215.6 / 157.3 | 206.7 / 156.1 | 222.8 / 170.4 | 221.6 / 170.1 |
| Office | 228.9 / 158.5 | 230.8 / 156.8 | 242.8 / 175.2 | 246.0 / 178.0 |

R7 Basement individual samples, run order:

| Run | Driver ms | Browser ms |
| --- | --- | --- |
| 0 | 223.222130 | 171.6 |
| 1 | 216.510729 | 165.6 |
| 2 | 244.714379 | 176.2 |
| 3 | 245.006651 | 177.0 |
| 4 | 255.336844 | 180.1 |

R7 Basement fails against capture 1 by 13.746%; Site (+2.748%) and Office (+7.455%) pass. Most of the browser-stage median increase already existed in R6. R6→R7 Basement adds approximately 4.1 ms to browser median and 20.6 ms to driver median. Subtracting these different measures does not attribute the remainder to automation, scheduling, networking or a component.

## Limits and next diagnosis

No concrete R7-specific material-list hot-path defect was established. Five samples and source equality cannot establish absence of a regression, explain shared chunk costs, or dismiss a failing gate as noise. Existing browser marks/two-frame readiness are not hardware presentation proof.

The smallest useful additional evidence, if separately authorized, is a source-bound material-list phase diagnostic across Phase0/R6/R7: actual input, router dispatch, Replicache-ready destination DOM, two-frame completion, and relevant resource/read counts. This could separate already-present preparation/render work from later waiting; it would remain supplemental evidence, not a selective replacement for the full gate. No such trace or new run is authorized by this audit.

## Follow-up: baseline→R6 destination mount hypothesis

Source inspection only; no profiler, runtime counts, new timing, or production change. This examines work already present in R6, not an R7-specific cause.

The frozen baseline lab source `/tmp/foremanhq-speed-app-5h2kmq` has the same `MaterialListScreen.tsx` as sealed Phase0. Its relevant source hashes are below; auth/private-database lab transforms are not the differences identified here. R6 paths refer to the sealed R6 directory above.

| Source path | Frozen baseline SHA-256 | R6 SHA-256 |
| --- | --- | --- |
| `src/components/materialLists/MaterialListItem.tsx` | `4dbf23058d9fef66b845955b7cd77009903268eb0f6fd00f301e9cbef6e2d78c` | `53bc702f7d0adddbf4044353bbc7ca19de91ca139bf7061c5447b9f353cc1b90` |
| `src/components/materialLists/MaterialListScreen.tsx` | `af9f991360e11cef398015dc045659759444b79a23712cf64e9d34d4f685147b` | `78a5d99d4651eff90d2524f5af1ebf42ed4182c35b4d7761a1742201497e08ac` |
| `src/components/materialLists/QuantityControls.tsx` | `e8327ff7be1115aa94e665e6da464521d0d8094ba798cbd45cbec56df450b87b` | same |
| `src/components/ui/button.tsx` | `0110ccd24f207397b5351f333be48f0604fbc6512ce4060699043a07b094e718` | `97924c8dabde09f38b5bcaf232322b46e16c27d2652cc98cee48a4033e65b5fb` |
| `src/hooks/use-replicache-material-list.ts` | `3d93560269fb3dcea4a7c1a6e5156182f4573c68df5f7f2e156c70a6039eea0f` | same |

Additional R6 source hashes:

- `src/hooks/use-press.ts`: `a2df179682c0927a8b589bfd0fee1c9c88e3eee2ee56a1395def2ae8e27f6e80`
- `src/hooks/use-instant-receipt-verification.ts`: `7af92f4f95b2dbafae722b5dc571bd30d18beeaff32750d846fa4db2ada4b04f`
- `src/hooks/use-queued-receipt-intent.ts`: `ec56661c7393783123f7a674505f1127fd889a2d4b9141e2f4414ff5ffb8f1dc`

The frozen baseline `perf/lab/seed.ts` SHA-256 is `f4bf8a4b66ce237a7cdc921bad58fd98dbaf693e855e10e8ffe53d22b5d87835`, matching the method seed inspected in the working repository. Lines 89–97 create 25 parts; lines 136–147 create 25 quote items with only index 0 linked to the sent order item. The parts omit pack sizes.

R6 `MaterialListScreen.tsx:514–544` maps grid rows into `MaterialListItem`; `verifyMode` is true for an explicit verification order or a receivable order line. For the ordinary default-grid fixture, the expected tree has 25 rows, one sent/receipt row and 24 unsent rows. `MaterialListItem.tsx:842–858` renders `QuantityControls` for unsent, non-verification rows. Its unchanged plain horizontal branch (`QuantityControls.tsx:237–285`) renders Increase and Decrease buttons: **at least 48 quantity buttons** before counting menu/header controls. These are source-derived expected counts, not observed mounted DOM/profiler counts.

Two concrete additions scale with those rows/controls:

1. R6 `MaterialListItem.tsx:227` unconditionally mounts the queued receipt-intent hook. Lines 229 and 246 add two receipt-related `useLayoutEffect` callbacks without dependency arrays, copying the latest permission/guard and receipt values on every commit. They execute even with `verifyMode=false`: **50 added layout callbacks for 25 expected rows**, including 48 callbacks across the 24 non-receipt rows. The queued-intent hook also registers its cleanup effect (`use-queued-receipt-intent.ts:34`), preserving the grid's cancel-on-unmount policy.
2. R6 `Button.tsx:67–74` unconditionally mounts `usePress`, including default release controls and Slot children. `use-press.ts:93–118` adds one state, three refs and two passive effects per button. For the minimum 48 quantity buttons this means 48 states, 144 refs and 96 passive effect registrations, plus handler allocations/attributes. This is destination mount work even though these quantity buttons were not pressed. The passive effects' scheduling relative to readiness is not established; only the layout callbacks are necessarily in the commit's layout phase.

There is also screen-level receipt preparation (`MaterialListScreen.tsx:215–227`): scan items into receipt snapshots and always mount the new helper. `use-instant-receipt-verification.ts:27` evaluates a new Map as the `useRef` argument on each render; lines 28–50 build another Map and queue preview reconciliation. With no previews the updater returns the same state, so this is allocation/scan/microtask work, **not evidence of a guaranteed extra render**. The hook effect depends on snapshots and previews; the row layout effects have no dependencies. The underlying Replicache reader remains unchanged.

A plausible narrow hypothesis is extra destination render/commit cost from shared Button mount fanout and inert receipt bookkeeping. No cost was measured or attributed, and this cannot explain the R7-only change by itself.

### Extraction constraints, not an implementation proposal approved to run

A conditional receipt hook call inside the current row is unsafe because `verifyMode` can change. A separate ordinary-row/receipt-controller boundary could avoid mounting receipt-only state/effects for inert rows, but the current receipt state, handlers and rendering are intertwined; a safe extraction must preserve row identity, mode-change initialization/reset, latest bulk/readOnly guards, duplicate suppression, cancel-on-unmount debounce, and already-authorized request behavior. Table receive intentionally uses a different flush-on-unmount policy and must retain it. Moving callbacks back into replayable React state updaters is not acceptable.

Simply returning early inside the two layout effects still registers/invokes the effects and may save little. Shared Button press cost is a separate potential target; no default gesture/keyboard/Slot behavior should be removed based on source counts alone. Profile evidence should precede either correctness-sensitive change. No extraction, profile or additional run was performed or authorized here.

## Authorized supplemental capture attempts: no profile evidence

Root authorized the bounded two-capture baseline/R6 visited Basement4×CPU diagnostic. Both attempts stopped **before any Profiler/Tracing capture**; neither produced a CPU/timeline file or timing sample. No performance attribution or patch is supported.

- [Attempt1 archive](artifacts/material-list-cpu-diagnostic-2026-11-11-attempt1/README.md): instrumentation error applied3second page defaults during preparation; baseline navigation timed out. Zero captures. Root explicitly authorized one corrected attempt; this was not an automatic retry.
- [Attempt2 archive](artifacts/material-list-cpu-diagnostic-2026-11-11-attempt2/README.md): corrected60second preparation and3second capture bounds, new method hash/attempt ID. Both source-attested private fixtures passed14-query preflight and exact source/privateDB process binding checks. Frozen visited preparation completed on baseline, then the strict request guard stopped it before capture. The rejected-path array was not serialized on this failure path; its exact request is unknown. No weakening or further retry.

The [driver](material-list-cpu-diagnostic.mjs) and exact executed copies/scripts/configs/logs/reports are retained separately from the frozen acceptance method. `node --check` and shell syntax checks passed before execution; no successful capture or harness functional test is claimed. Both runs exited1 with both app PIDs and private PG directories gone and empty PG error reports; browser/context cleanup ran in finally. No production app source, acceptance artifacts or thresholds changed. The source-derived mount-work hypothesis remains unproven.

A separately marked [unexecuted v2 method](artifacts/material-list-cpu-diagnostic-unexecuted-v2/README.md) fixes the driver metadata-loss defect: top-level sanitized rejection metadata is written before abort, including preparation failures. No guard is loosened; only method/fixed endpoint shape or procedure pathname/reason are retained, with no queries, bodies, cookies or arbitrary paths. This source revision has not been run or syntax-tested; both executed copies/hashes remain unchanged. No third attempt.

## Reviewed third attempt: concrete startup-mutation guard failure

Root subsequently authorized a third attempt and a reviewed v3 guard covering
same-origin catalogue pulls and numeric telemetry already present in both sealed
sources. [Attempt 3](artifacts/material-list-cpu-diagnostic-2026-11-11-attempt3/README.md)
passed both source/private-database bindings and 14-query read preflights, then
stopped before either profile on `POST /api/trpc/appDevices.report` and one
redacted POST. Zero captures. Header mounts AppDeviceReporter, which reports its
fresh browser-local device on the first animation frame; the procedure upserts
the seeded user's device observation through `ctx.db`. This is a genuine startup
mutation, correctly rejected by that method's narrow guard. The unidentified POST
cannot be attributed to a source endpoint from the retained metadata alone.

The copied v2 driver remained unexecuted; its coordinator prepared fixtures and
waited at an unreleased barrier. A separately frozen v3 launcher ran the actual
method and cleaned that setup coordinator. All exact driver/dependency/config
hashes, source/schema/fixtures/preflight evidence, raw failure and empty post-stop
PG ERROR reports are archived. Both servers/private databases were removed and
the quiet window was released. Prior attempts/methods/full gates remain unchanged;
no CPU attribution or threshold/performance claim follows. Root may separately
review the permitted synthetic bootstrap writes for a distinct future method.
