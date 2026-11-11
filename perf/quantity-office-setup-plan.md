# R17/R18 quantity diagnostic setup — source-only, not run

This is an unexecuted operational proposal for the separately reviewed `quantity-office-diagnostic.mjs`/observation helper. It neither edits the frozen f9 timer nor changes R18's failed gate. Root must review and freeze all method files and authorize runtime before the single invocation below. No app rebuild or third capture is proposed.

## Exact app and fixture identities

| Role | Immutable source | Canonical build | Source fingerprint | Retained lab | Lab build | Port |
|---|---|---|---|---|---|---|
| baseline = R17 (not acceptance Phase0) | `releases/speed-phase1-combined-r17-20261111` | `b1c2adf31950c6f3db7ab189bbeabce29df5d6d9766418f3a9935bdde94f234b` | `be7f23501ec71b78974bc9f818fc75b46abfd0a4de0ad83288de7a49826c37cc` | `/tmp/foremanhq-speed-app-epcRJM` | `zNd84I0aO-5wNGl7s3g4z` | 3485 |
| candidate = R18 | `releases/speed-phase1-combined-r18-20261111` | `c58613f12a7ae0590934ecdb15ddbc7a39e3a2f587f26d5f98792c92a4de64e8` | `ec149c2ed24935019cae5150c928b9af6606d8c41c8eba552d2a9185cf1b05dd` | `/tmp/foremanhq-speed-app-mIZVko` | `kQwDUUMWJAxQExPo56xqn` | 3486 |

`quantity-office-reuse.mjs` checks real paths, PERF_LAB_ONLY, actual compiled BUILD_ID and canonical BUILD_ID, prior/current source fingerprint, counts2316/2317 and unchanged counts2311/2312 with the existing five declared transforms. The runtime socket guard must exist. Only generated fixtures, synthetic uploads and source attestation metadata are refreshed. Prior fixture/preflight/source metadata is copied first; historical reports remain untouched. Code refresh and snapshot builds are absent.

Two fresh `database.sh` owners use different `/tmp/foremanhq-perf-pg.*` directories, Unix sockets only, port55463/database foremanhq_perf_lab. Each app gets matching DATABASE_URL/PERF_LAB_DATABASE_URL, its own explicit PORT, separate background mode and disabled BIM. Existing compiled next.config derives explicit private PostgreSQL socket options. Driver checks actual PID/cwd/fd1/fd2, env binding, attestation identity and14 source-bound endpoint reads. No environment dump or credentials are archived.

## Read-only selected-item proof

The seed creates25 quote items: one sent row and24 ordinary rows, all quantity10. It does not expose quote-item IDs in fixtures. The new `quantity-item-preflight.mjs` uses explicit Unix socket PostgreSQL options and a READ ONLY transaction, verifies actual database/port/transaction_read_only, joins the exact seeded organization/job/list/quote, verifies25 unique IDs/names and24 ordinary rows with no room/supplier modifiers. It emits a bound ID/name/quantity map, not an assumed first ID. No index0/index2 guess, sort duplication or React internal inspection is used.

After the original unmodified prepare, the diagnostic matches the actual first Playwright Increase button and Quantity input to the same nearest existing Card, exactly one h3 and one of each control. The unique synthetic heading/quantity joins precisely one eligible SQL row. Only then is expectedQuantityItemId assigned in memory and persisted as derived binding evidence before the selected +1 push is allowed. The sealed input config stays unchanged. Ambiguity, hidden-selector disagreement, sent-row selection or quantity mismatch stops before capture. No production DOM attribute is added.

The proof JSON binds sourceBuild/fingerprint/labBuild, source-evidence/fixture hashes, list/org and current socket/readonly database identity. The browser only receives the single exact updateItemQuantity allowance after that proof; identical envelope retries are latched, other nonempty writes stay rejected.

## Prepared invocation and bounds

Freeze the exact reviewed driver, observation helper and these six operational files under a new immutable `/tmp/foremanhq-quantity-office-method.*` directory, with a `METHOD.json` mapping relative paths to SHA256 and protocol `quantity-office-cpu-diagnostic-v1`. Keep its node_modules link to the already installed dependencies. The exact source files to freeze are:

- `perf/quantity-office-diagnostic.mjs`, `perf/quantity-office-observation.mjs` (navigation agent ownership).
- `perf/lab/quantity-office-{setup,server}.sh` and `quantity-office-{reuse,finalize}.mjs`.
- `perf/lab/quantity-item-preflight.mjs` and `owned-process-supervisor.py`.

After root authorization only, the bounded command is:

```sh
PERF_QUANTITY_METHOD_ROOT=/tmp/foremanhq-quantity-office-method.<reviewed> \
  python3 /tmp/foremanhq-quantity-office-method.<reviewed>/perf/lab/owned-process-supervisor.py \
  run --seconds 480 \
  --record /tmp/foremanhq-quantity-office-v1-attempt1-outer-processes.json \
  -- bash /tmp/foremanhq-quantity-office-method.<reviewed>/perf/lab/quantity-office-setup.sh
```

The setup script verifies all method hashes before starting any DB/browser; refuses an existing attempt directory; launches two distinct sealed-f9 private owners (460s each), waits at most150s for both read preflights and proofs, writes/hash-seals actual config, then invokes exactly one driver under an independent180s owned-process watchdog (TERM2s, KILL2s, bounded wait). No automatic retry. Baseline/R17 is first, R18 second. Per-app shared3s capture deadline includes profiler/trace setup, unchanged adapter action and profiler/trace stop/completion. Trace transfer is afterward, bounded by per-read/close3s and the overall180s; profiles perturb timings and do not replace gate numbers.

Source review requested stopping the observation immediately after original action, before trace stop/IO transfer; navigation's revised driver implements it. This prevents geometry frames from extending throughout trace export. A shared deadline means no >3s capture may pass, while failure teardown may take bounded extra time and remains labelled failed. Two traces≤20MiB each/CPU≤5MiB each/aggregate≤55MiB remain diagnostic limits.

## Teardown and archival contract

Server EXIT traps stop/wait their own Next child, attempt every schema/fixture/PGlog/source-after copy, explicitly exit nonzero on copy/source/child failure and preserve original/final codes. Coordinator stops both Next PIDs, gives each owner up to15s to let those copies finish before database helper cleanup, then forces only its own stuck owner and marks failure. Fresh schema is saved before app start and again after; preflight, readonly proof and source-before/after are retained. Finalizer checks both actual PIDs absent, ports closed, socket directories removed, PG errors empty, copy traps successful, input config and frozen method hashes unchanged. Partial setup/capture failures are preserved under the unique attempt root, never labelled complete.

Private The server wrapper explicitly stops its owned private PG with pg_ctl before copying its final log; the unchanged f9 helper then performs idempotent cleanup and its post-stop error summary. No source PDF/customer contents or arbitrary request bodies/cookies are included. Before publishing trace-derived excerpts, retain raw private traces and inspect for source URLs/content; request guards report sanitized fixed paths only.

Owned-process supervisors start new sessions and track PID start time/process groups plus a unique inherited token; descendants are included, including detached/reparented children. Linux child-subreaper handling reaps orphan children. TERM2s then KILL2s and bounded wait verify recorded owned identities absent; failures are nonzero. Discovery scans /proc and updates records every100ms, adding diagnostic-only host load. This supervisor must never be reused to claim acceptance timing. Source tests cover original exit codes, ignored-TERM detached children, external stop and record-write failure after successful spawn; no app/browser/DB is used. No runtime diagnostic has been executed for this preparation.
