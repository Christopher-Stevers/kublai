# Material-list CPU/timeline diagnostic — attempt 4

**Two completed supplemental profiles, not an acceptance gate.** Exact Phase0/R6 retained compiled apps, fresh private PostgreSQL databases and generated fixtures; both14-query read preflights passed. No builds, physical phone, production writes or app source changes. The previous three failures and unexecuted v2 copy remain unchanged.

Root reviewed v4's exact same-origin startup exceptions: catalogue/material-list read pulls, empty sync pushes, numeric lab telemetry, `appDevices.report` (seeded-user/private DB only) and `/api/debug/client-console-error` (identical frozen route only console.error to this private process's redirected log, no external alert/shared log). Arbitrary/nonempty other mutations and external origins stayed blocked. Zero guard rejections. Driver/dependencies/launcher were sealed before setup and config hashed/sealed before the GO barrier; all before/after hashes match. Capture was10:57:06.788–10:57:49.782UTC on2026-11-11 including both preparations; each actual profiler interval was under one second and driver capture interval under400ms. Raw CPU+trace total1,628,574bytes, below all caps.

## Observations

| Measure | Phase0 | R6 |
| --- | ---: | ---: |
| Trusted pointerdown mark → click mark |1.408ms |7.347ms |
| Click mark → destination observer ready |146.767ms |147.711ms |
| Ready → second rAF opportunity |62.536ms |62.695ms |
| React-runtime anonymous FunctionCall interval |56.715ms |57.024ms |
| Diagnostic observer FunctionCall interval |48.698ms |48.203ms |
| Visible Increase controls |24 |24 |

The substantial `getClientRects` sample stacks descend from our injected `observe` callback. Its roughly48ms interval is **diagnostic overhead**, not evidence the app itself spends48ms there. The observer, timeline and CPU sampling perturb the work and can hide or alter the previously observed difference. Native pointer dispatch is also recorded; frame-sized differences alone are not causal evidence.

The24 observed Increase controls corroborate the source fixture's24 ordinary rows/48 quantity buttons. They do not count receipt layout-effect or press passive-effect invocations. The minified React runtime, DOM mutation calls and code-containing receipt/press modules are sampled; they do not isolate each component's render/commit cost. No named IndexedDB functions were sampled; asynchronous waits and unobserved work remain possible. No significance or performance-pass claim follows from one capture per source. Original full gate definitions and failures remain untouched.

`analysis.json` groups weighted CPU samples by phase, script, exact webpack module and callframe; inclusive module weights overlap and must not be summed. Module string markers describe code present, not a guarantee which component executed. Both raw profiles contain negative time deltas (29/34); the **post-capture** `analysis.mjs` accumulates original timestamps, sorts samples chronologically, and clips intervals for descriptive weights. Original profile bytes are unchanged. Trace FunctionCall intervals can nest/overlap. `analysis.mjs` is archive-time analysis tooling, not part of the executed frozen timing driver.

Both Next servers and private PG directories were removed, both PG ERROR reports empty, and owned ports3482/3483 closed. Quiet released after cleanup. There was no declared agent-driven heavy work/ADB, while ordinary OS and live production services continued. Source bindings were independently rechecked after cleanup. `sha256sums.txt` binds all raw evidence, method/provenance and offline analysis.
