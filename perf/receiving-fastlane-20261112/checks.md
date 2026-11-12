# Receiving dev RC validation

This receiving change follows Tim's 2026-11-12 **dev deploy first, review afterwards** policy. Own tests and canonical TypeScript/build/health checks precede dev deployment. Timing calibration, baseline pairs and byte measurements remain review/production-promotion work; they do not block the dev lane. Root owns the deployment lock/switch/health/rollback/queue entry. This validation does not authorize a schema migration, worker release, autopilot activation or data deletion.

## Source boundary

Runtime source is `/home/tim/.openclaw/workspace/releases/speed-phase0-receiving-rc-20261112-dev1`, fingerprint `f62224056be1245581c9a440a5777a921d8d36f3076e33156214ae78008785c3`. It is active Phase0 + wizard plus the nine reviewed receiving runtime paths: RC `4284faaf`, `5ae53190`, `3243df60`, and the merged `3a777` receiving guard/test correction recorded in the manifest. No broad Phase1 source is included.

Separate validation source is `speed-phase0-receiving-rc-validation-20261112-dev1`, fingerprint `bbd8764c4de45d72e15ffa7798d3fbe4ee41914e246747f6a007716967484ed5`. It has exact active test preimages plus six reviewed RC validation postimages and a `PERF_LAB_ONLY` marker. Runtime manifest SHA is `3f202c043a4e9988b804227f78cace88372d39b1a0ee6ba3a237b526915d304c`; validation manifest SHA is `fac76e6f0444d23fbfb1512f57252248a091e7a3f071a424e27e44e51894c57a`.

MaterialListScreen/ReceivingWorkspace changes are narrow backports; the nonexistent later ReceivingResolveContent label change maps to the active original ReceivingResolve.tsx, without its later lazy split. Service runtime/schema/worker are unchanged. The shared resolution helper is also used by worker source, but no worker bundle is released here.

## Focused tests

The source-bound one-worker unit command runs these exact files:

- `src/lib/receiving-resolution.test.ts`
- `src/lib/receiving-completion.test.ts`
- `src/lib/receiving-progress.test.ts`
- `src/components/materialLists/ReceivingWorkspace.test.tsx`
- `src/components/materialLists/OrderWaitingWarning.test.tsx`

They cover short/zero delivery without a mandatory BO decision, outstanding quantities remaining due, cancellation/excess/wrong-part/invalid count blockers, one Accept resolving rather than posting a receipt, plain wrong-material labels, outstanding-order warning contents/keyboard access, and existing permissions/stale/account cases. Minimal root Vitest config uses the validation source alias and the existing one-line jest-dom setup. **151/151 tests passed**; this is mocked UI/pure behavior, not a browser or authority integration proof. Logs/config hashes and exact commands are recorded in `checks-receipt.json` and `validation-results/`.

## Real private service fixture

`service-private.sh`, `service-prepare.mjs`, `service-client-guard.ts` and `service-method.json` implement the bounded fixture wrapper. The original integration test is never overwritten: a generated sibling adds only explicit private client options (`user`, `ssl:false`, `fetch_types:false`) and verifies actual constructor/socket/database/user/server/data-directory identity before fixture SQL. Three empty catalogue lookup tables omitted by the original fixture are generated from frozen schema column types, without unused defaults. Original test behavior remains unchanged. Generated fixture/config files are removed and the original full validation fingerprint is verified afterwards.

The wrapper uses `env -i`, private Unix-socket PostgreSQL, no TCP listener, synthetic rows, mocked production DB/auth/extraction/push, the existing owned-process supervisor, a 300-second test limit and bounded PG setup/stop. Exact `23514` for the authored `block_confirmation` rollback test must occur once; all other PG errors fail. Final logs, actual client identity, source before/after and cleanup are retained. Inner cleanup explicitly records a stopped postmaster zombie; the outer subreaper must then prove every owned identity absent. Missing evidence or failed cleanup fails closed and retains the private directory.

The first attempt passed all 100 service assertions but the wrapper rejected two missing-category fixture errors plus its pre-reap zombie audit. The second attempt failed before assertions because the legacy thin-fixture DDL builder emitted an unquoted JSON default for the newly included material table. Both attempts remain preserved; neither is reported as an operational pass. The corrected fixture creates only the missing empty lookup tables without defaults. The corrected third attempt passed **100/100 service tests**, wrapper and outer supervisor exit 0, exactly one expected rollback error and zero unexpected PG errors, stable before/after source fingerprints, private socket/data directory removed and every outer-owned process identity absent. The original failed attempts are archived separately in `validation-results/service-attempt1` and `service-attempt2`.

The service suite checks real transactions: receiving six when two were already received produces eight received while ordered stays ten; cancelled remainder rejects without changing receipts; existing rollback, stale fingerprints, duplicate receipts and permission cases remain. This is a thin synthetic schema with mocked auth/DB injection, not a full migrated schema, compiled topology, external extraction/push or worker proof.

## Execution and receipt

Each service attempt uses a new evidence/owner record and the exact reviewed method SHA:

```sh
python3 perf/lab/owned-process-supervisor.py run --seconds 420 \
  --record <new-owned-outer-record> -- \
  bash perf/receiving-fastlane-20261112/service-private.sh \
  /home/tim/.openclaw/workspace/releases/speed-phase0-receiving-rc-validation-20261112-dev1 \
  <new-private-evidence-directory> <reviewed-service-method-json-sha256>
```

`checks-receipt.json` binds runtime and separate validation fingerprints, exact full test paths/commands, logs and SHA256 values. Total: **251 passing tests** across the five unit files and real private service suite. All test, PG and owned-supervisor processes are stopped; unit scratch config/setup were archived and removed from the validation tree. Canonical build supplies the full production TypeScript check; no redundant standalone tsc is required. Root reviews the receipt and build/health evidence before the dev switch.

## Later calibrated review/promotion inputs

The unchanged calibrated policy requires complete fixed B +19 independent full controls, every raw report/plan SHA-bound, matching method/protocol/toolchain and actual per-cell restore/reset/restart/14-read certificates. Candidate review uses a matching active-source `{baseline,repeat}` and a later full 360-sample candidate (24×15 plus original idle), with exactly one predeclared fresh confirmation for each initially failed cell and no pooling/reset. Historical five-sample reports are not converted. Static delta compares actual active source. Full gates remain for production promotion; failed/incomplete calibration is preserved, not waived or repurposed as a dev deployment veto.
