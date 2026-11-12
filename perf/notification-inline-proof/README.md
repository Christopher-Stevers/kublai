# Actual inline notification ownership: prepared proof

**Unit stage and the single authorized inline browser attempt passed. No application release or activation is implied.** The earlier acca100a proof used a synthetic lazy panel; it does not validate this inline transplant. All helper/test files are outside hashed release inputs.

## Exact bindings

Runtime and all application dependencies bind `/home/tim/.openclaw/workspace/releases/speed-phase1-notification-owner-20261112`, fingerprint `2c5a75daf1d3bcc2aa3468ce5877da8b0311ce8b15a70d0098a7ea7747a87421`, 2,201 inputs. Center SHA `446166895108e67d02d81421e2aa5d0d481672d73bfcb7b561ef5a4dd02031fe`; owner hook SHA `3d1d0bbc15bb85e9ac3d1afd820b73c3b85148d189d3ec15385b80f0b122bdc5`.

`prepare.mjs` verifies this complete source fingerprint using the already sealed f9 source-fingerprint helper and checks both runtime hashes before preparing an isolated temporary Vitest config. All `~/` aliases bind this frozen source. Relative runtime imports naturally remain there. Installed dependencies use its node_modules symlink. No current-HEAD application source is copied. The release deliberately omits root test tooling. Operational setup is pinned to `669d7f83:vitest.setup.ts` (SHA-256 `91a3c8962a0edcb956206a501d943fe99e1c78c6d4d8b5c9a948a3362c75978c`), verified and written only to the temporary test root; it is not added to frozen inputs. This also avoids the earlier outside-root Vite failure.

## Prepared units

- Exact thirteen owner tests from committed acca100a, with only test imports rewritten to frozen aliases. They cover manual/hydrated data versus real RPC, request deduplication, real cadence, errors/no retry loop, actor/simulation/Activity and starting-authority races.
- Frozen original Phase0 Center presentation suite, with original assertions retained. Only imports and the new owner-hook fixture contract change; this suite is not authority evidence.
- Six new actual-inline integrations (`inline.test.tsx`) with a real QueryClient and actual inline Center, Dialog, rows, filter, settings mode, JobNotificationSettings, read/Close. Only transport, online/simulation inputs and external push capability are fixtures. Cases cover All-filter/Dialog identity, settings switch/state, actual row/read/navigation/Close, benign offline/Activity retention, pre-binding manual cache and terminal denial/recovery. No NotificationPanel/body replacement.

Commands, **only after runtime clearance**:

```bash
node perf/notification-inline-proof/prepare.mjs > /tmp/notification-inline-unit-prepare.json
notification_inline_unit_dir=$(node -p "JSON.parse(require('fs').readFileSync('/tmp/notification-inline-unit-prepare.json','utf8')).directory")
NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run --config "$notification_inline_unit_dir/vitest.config.mjs" --maxWorkers=1
```

The config is disposable; preparation itself does not execute tests. Focused lint/types must be scoped and compared honestly if inherited findings appear. No full Next build is part of this proof.

## Prepared browser

`browser.mjs` reuses the reviewed parent/worker supervisor pattern, 90-second outer bound and 85-second internal watchdog. Each attempt creates an exclusive artifact directory, records owned Chromium PID/start time, and verifies process exit, loopback port closure, temporary-file removal and before/after source/helper/dependency hashes. Forced-timeout cleanup is source-prepared, not independently proven. No automatic retry; fixture failures remain archived.

Actual inline Center and JobNotificationSettings are bundled from the frozen source. The browser has actual online/activity dependencies; simulation remains its real default context. Only synthetic tRPC HTTP transport, a router capture and unrelated PushNotifications external capability are seams. No synthetic NotificationPanel, filter/body or settings-mode replacement exists. The esbuild input list must include actual Center/hook/JobNotificationSettings and no NotificationPanel. Complete frozen source and all bundled frozen input hashes are checked before/after.

Synthetic 250 ms local replies implement identity/overview/list/jobSettings plus explicit in-memory read/settings ACKs. These are not production authentication, tRPC batching, persistence or permissions. Server records only synthetic inputs/counts/timestamps. No Next app, database, worker, external requests, production writes or acceptance timing method.

Browser command, **only after separate coordinated GO**:

```bash
node perf/notification-inline-proof/browser.mjs > /tmp/notification-inline-browser-attempt1.log 2>&1
```

Declared checks:

1. Open actual inbox; choose All; prove real list input `unreadOnly:false`, real row and same Dialog DOM.
2. Enter actual settings mode; wait for actual JobNotificationSettings switch. Keep this mode through two real 30-second overview cycles with 250 ms replies. Require four overview replies total (bootstrap/open/two cycles), one identity reply during that window, each last gap ≥29 s and total span ≥59 s. These tolerances are scheduling checks, not speed budgets.
3. Toggle the actual job setting through synthetic ACK, return and retain All. Mark all read through the real controller; wait for ACK plus updated badge before Close/reopen. Preserve actual read-row navigation behavior.
4. Keep All/Dialog through offline/reconnect and cooperative hidden/resume with fresh identity catchup. Unit integrations additionally cover actual React Activity and deferred authority races.

Any failure stops this attempt, preserves report/supervisor/log/source hashes and performs owned cleanup. No claim of application idle savings, field/Pixel latency, full matrix, release eligibility or activation follows. Root reviews results before selecting this candidate.

## Unit-stage results

29 tests across three files passed on both runs: 13 ownership, 10 original presentation and six actual-inline integrations. Scoped new-test and exact frozen Center/hook ESLint logs are empty. Scoped no-emit TypeScript (frozen runtime import closure plus fixtures) completed with an empty diagnostic log. This is not a canonical production build. Syntax checks passed for both runners.

Initial lint found four fixture unsafe-return errors; initial types found fixture infinite-query options and Testing Library role-option errors. Typed transport wrappers, a default overridden by actual pagination options, and removal of unsupported fixture-only `exact` options corrected these. Earlier logs and both passing test runs are retained in `../artifacts/notification-inline-units-2026-11-12/`. Frozen runtime was not changed. Browser cadence/cleanup remains unproven for this inline transplant.

## Actual inline browser result

The single authorized attempt passed: [raw report](../artifacts/notification-inline-http-attempt-4o5LwR/report.json), [supervisor](../artifacts/notification-inline-http-attempt-4o5LwR/supervisor.json). Actual inline settings/Dialog identity survived overview start gaps of 30,256.66 and 30,255.82 ms (60,512.48 ms span), with one identity and four overview replies in that window. Actual All filter, settings mutation ACK, read ACK, Close/reopen, offline/cooperative pause resume and read-row navigation checks passed. No external requests or browser errors occurred.

Supervisor exited zero without timeout; owned browser process absent, browser/server closed, actual bound port 37811 closed, temporary files removed. Complete frozen fingerprint and every recorded helper/bundled input hash matched after execution. This synthetic component HTTP proof is not production authentication, tRPC batching, application idle savings, full-matrix speed or activation evidence. The runtime source was unchanged. No retry was performed.
