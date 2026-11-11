# R19 jobs-shared attribution audit

Source/stat audit only, 2026-11-11. No adapter implementation, build, browser, journey or timing run.

The unchanged formal jobs client-reference intersection is **477,538 gzip bytes**, against the plan's 120,000-byte target. `perf/analyze-shared-bundle.mjs` reproduces that total from the exact canonical R19 build `47b6e70541a3f513f852e93aef05aa4f389544f72f4626082f447f53d0956ece` (source fingerprint `4541b37e0ff7144287d9187384eeb9ae7ebe1c9aa88e31fcaa53cee03a8b05c7`). Root-main/framework chunks contribute 118,402 bytes; the remaining application-shared classification is 359,136 bytes. This classification is not a claim that every remaining byte is application code or optional.

Inputs are `/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r19-20261111/.next-web/analysis/client-stats.json`, `build-manifest.json`, `server/app/*page_client-reference-manifest.js` recursively, and the matching emitted static files. Existing canonical metrics are also preserved in `perf/artifacts/phase1-r19-build-proof-2026-11-11.json`. Per-chunk gzip uses level9; module sizes below are webpack pre-minification estimates, not additive compressed attribution. The formal reference intersection includes conditional references and is distinct from actual per-entry startup transfer or the receiving route union. No metric or threshold was changed.

| Shared emitted chunk | Exact gzip bytes | Source interpretation |
| --- | ---: | --- |
| `7788-2e05fdee5b120ab7.js` | 31,513 | tRPC/TanStack client machinery; required JSONL decoder must remain |
| `5a989347-45d1cd9b68fb9192.js` | 29,600 | Replicache engine; not an optional widget |
| `2359-ffb01904d07feef2.js` | 29,089 | Clerk/SWR identity machinery; no auth deferral proposed |
| `9228-94d95b68e184b4ba.js` | 24,095 | Zod and shared runtime schemas; no unvalidated replacement proposed |
| `9448-bad7c01765305b9d.js` | 17,273 | Radix menu/dropdown and Floating UI; next possible optional boundary |

The bounded menu opportunity is the eager `~/components/ui/dropdown-menu` imports in exactly three shared source modules: `src/app/_components/Header.tsx`, `src/app/jobs/JobsClient.tsx`, and `src/components/materialLists/MaterialListCard.tsx`. Header mounts its desktop menu even when CSS hides it. Jobs/list cards also mount their action menus before opening them. The shared stats attribute Radix menu37,936, Floating UI core36,167, DOM27,498 and dropdown13,957 pre-minification bytes to the 17,273-byte emitted group. Other consumers may retain some shared utilities after extraction; **17,273 is an opportunity ceiling, not a measured saving**.

A future reviewed option is a lightweight action-menu adapter plus deferred existing Radix content for those three callers, preserving callbacks/account ownership. It must not degrade first-open feedback, Escape/arrow/Enter behavior, focus return, touch-scroll cancellation, disabled items or job-card propagation. Reparenting/remounting the trigger on delayed import is a concrete focus risk. Import failure/retry must not activate actions or reload a parent draft. These costs may outweigh the modest saving; no implementation is approved now. Existing SnapshotControls and other completed lazy splits should not be counted again.

The shared target gap remains 357,538 bytes. Removing one menu group would not approach the target, and no framework/compiler/metric workaround is proposed.
