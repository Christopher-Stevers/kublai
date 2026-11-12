# Phase 0 wizard fast lane: bounded functional proof

**Approved `669d7f83` postimage passes the isolated commit suite (9/9) and the corrected component-browser proof.** This evidence supports the one-file bug fix; it is not a full application/Pixel or performance gate. No production runtime, frozen source, schema, worker or public file was changed by this proof. The separate candidate build/full gate/activation remain root-owned decisions under `/home/tim/Documents/foremanhq-fastlane/REQUEST.md`.

## Exact source and unit evidence

The frozen Phase 0 `CatalogueVisibility.tsx` is byte-identical to `669d7f83^`: SHA-256 `01cd2bd87133a6318bcb6ebe587601d5456525c0262f43e4b8bac4e18c80b5ae`. The selected approved postimage is `bc8b16aed9e92b1d4319dd65fc77c54547efc38e04185c16279c85afb0ca5c1a`. Its exact commit test suite passes nine tests with one worker. The earlier proposal mistakenly called this ten; nine is the actual count.

[Unit proof, configs and logs](artifacts/fastlane-wizard-unit-2026-11-12/proof.json). All `~/` aliases bind frozen Phase 0 source except the exact selected CatalogueVisibility temporary blob; actual frozen WizardOptionCard/Card dependencies are used, not current shared press/Button changes. First attempt ran zero tests because Vite could not resolve the outside-root setup; copying exact Phase 0 setup into the isolated root and explicitly allowing frozen dependencies fixed only the harness. Both attempts remain archived. The successful external fixture directory is retained as evidence, not an active runtime.

## Actual browser result

[Successful raw report](artifacts/fastlane-wizard-browser-attempt-9dj0Ue/report.json), [owned supervisor](artifacts/fastlane-wizard-browser-attempt-9dj0Ue/supervisor.json), [exact executed method](artifacts/fastlane-wizard-browser-attempt-9dj0Ue/method.executed.mjs), [fixture](../scripts/fixtures/fastlane-wizard/app.jsx).

The fixture uses actual frozen Phase 0 WizardOptionCard/Card with either baseline or exact approved CatalogueVisibility. Its real onTap updates React state and key-replaces the old Card at the same position. Only surrounding synthetic UI and the hide callback are fixtures. Playwright Chromium touch-capable mobile context supplies trusted browser input; this is not physical phone evidence. Local CSS only sizes the synthetic cards. No Next app, authentication, database, external network or live write is involved.

| Case | Baseline | Approved |
| --- | --- | --- |
| Two ordinary trusted native touch taps | Step **2**, then **4** | Step **1**, then **2** |
| Old Card actually removed | Yes | Yes |
| Keyboard Enter and Space | Pass | Pass |
| Moved touch cancels pick/hold | Pass | Pass |
| 600 ms hold invokes hide once, no pick | Pass | Pass |
| 400 ms guard expiry after Card unmount; later unrelated click works | Pass | Pass |

The native log records trusted pointerup on stage 0 followed by trusted detail-1 click targeting the newly mounted stage 1. Thus this small actual-component fixture **did reproduce** the native skip and the approved file prevents it. The raw report's generic “Native baseline non-reproduction is a limitation” line is inapplicable to this observed run; raw evidence is left unchanged.

Separate synthetic diagnostics are deliberately not conflated with native behavior:

- Explicitly dispatching a detail-1 click to the replacing Card after a synthetic lift advances baseline to 2, approved stays 1.
- Synthetic detail-0 assistive-style click passes in both variants.
- **Deliberately omitting the compatibility click**, then issuing a distinct native mouse gesture to an unrelated button within 400 ms, executes it in baseline but is swallowed in approved. This confirms the conditional global-guard gap under synthetic omission. It does not reproduce a failing ordinary native touch workflow and the user-approved postimage was not changed.

## Attempts and cleanup

The [first browser attempt](artifacts/fastlane-wizard-browser-attempt-QnrMlu/report.json) stopped before any server/browser: esbuild could not resolve dependencies from the selected blob's `/tmp` directory. Its exact method/log/source hashes are retained. Root explicitly authorized the concrete correction—symlink that temporary directory's node_modules to frozen Phase 0 dependencies—and one corrected attempt. There was no automatic retry or production fix.

The corrected attempt exits zero with no watchdog timeout, browser errors or external requests. Before/after source/helper hashes match. Browser process exited and owned PID was absent, server and bound port **40509** closed, and temporary bundle files were removed. The parent supervisor bounds work to 60 seconds; forced-timeout cleanup was not exercised. Deployment was explicitly notified that runtime was DONE before starting its canonical build. No further browser, asset-feature validation or timing run was started by this agent.
