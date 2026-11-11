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
