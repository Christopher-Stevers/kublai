# R12 validation — prepared, not executed

Runtime awaits root approval of the exact frozen R12 source, canonical build and
static ratchets. No raw HEAD overlay, source mutation, ADB, activation or implicit
retry. R6/R7 failures and accepted Phase0 baseline pair remain unchanged.

## Frozen full matrix

Use `/tmp/foremanhq-perf-method-f9bHR6`, fingerprint
`25dfa8bfb3977677cfdd0340d7de19cf68895cd80000e19d14e4867f36dd41c4`.
The predeclared comparison is
`perf/artifacts/baseline-ready-then-pinch-v2-rerun-2026-11-11-1.json`;
`…-2.json` is the stability reference, never a favorable alternate baseline.
One complete 8 journeys × 3 links × 5 samples = 120 capture, unchanged 4× CPU,
ready-then-pinch-v2 semantics, original metric, 10% regression rule and zero
sample exclusions. The frozen ten-minute idle observation also remains unchanged.
No functional fault injection or additional browser observer enters that driver.

After exact R12 metadata exists, freeze a reuse-only orchestration derived from
`artifacts/candidate-r7-ready-then-pinch-v2-2026-11-11-orchestration.sh` and its
fail-closed helper, replacing **only bound identity/output paths**, not the method.
A new isolated production lab compile is required: neither retained R6 nor R7 is
R12. It uses the sealed create-lab helper, exact frozen source/build/fingerprint,
Clerk stubs, private-socket transforms and no production auth changes. Archive
source evidence before/after permitted transforms, lab BUILD_ID, canonical static
metrics and distinct lab-byte caveat. Never use readonly perf-code refresh on a
reused snapshot; only fresh generated fixtures/uploads/attestation may change.

The wrapper is run under the sealed `perf/lab/database.sh` with exact
`PERF_SOURCE_ROOT`, `PERF_SOURCE_BUILD_DIST`, `PERF_BASELINE_DIST`,
`PERF_HARNESS_DIR`, predeclared baseline and marked compiled artifact. Those values
must be filled from root-reviewed metadata and validated, not guessed. Fresh
private DB and 14 real read preflights precede idle; reset writes/restart app
before the one matrix. Same-source canonical static.build must equal sourceBuild.
All method/config/launcher hashes are sealed before execution and rechecked after.
Expected runtime about 25–35 minutes after compile; hard outer bound 45 minutes.
All partial/raw failures survive; no automatic second capture.

Scope qualifications stay: synthetic Clerk excludes auth startup evidence,
stock next start transport differs from public Brotli wrapper, nonhex lab tag
excludes private-SW release/binding branches, shared host production/OS services
remain running, and desktop lab is not controlled Pixel proof. Old frozen idle
stream classification may omit `/api/live`; a separate functional transport
report must not silently repair that historical method or claim all polling gone.

## Separate compiled preference functional check

`live/compiled-preferences-functional.mjs` is a distinct source-frozen protocol,
not the acceptance driver. Prefer running it **before** the full matrix so a
webpack/private-adapter failure is discovered early. Reuse the exact compiled R12
lab sequentially, with a **different fresh private DB** and generated fixtures.
The standard lab transform patches the PG constructor to the private Unix socket;
it does not disable LISTEN. The real compiled `installedPostgresVersion` /
`listen.sql.options.onclose` path must work. A false-only readiness result is a
failure; never inject readiness frames or manually grant QueryCache certificates.

Configuration binds loopback backend/proxy, marked snapshot/lab BUILD_ID,
sourceEvidence, preflight, fixtures, server PID and its private redirected log,
expected canonical sourceBuild/fingerprint and unique output. The script verifies
cwd, private DATABASE_URL/socket/BIM/background settings, private log file FDs,
HTTP lab attestation and exact seeded admin before browser actions. Source schema
and all process/fixture evidence are copied before cleanup. Browser requests are
restricted to loopback; POST allowlist is exactly both Replicache read pulls,
empty pushes, numeric lab telemetry, private debug logger, appDevices.report and
user.setMaterialSortPreferences (only these mutation procedures in batches).
Arbitrary mutation/nonempty push/external traffic fails and is sanitized in output.

Assertions use actual Settings UI, actual HTTP responses and CDP-observed SSE:

1. Require actual `preferences-ready:true`, real successful matching
   `user.getMyRole` and preference HTTP responses, then enabled executive controls.
   Fail within 30 seconds if the bundled driver never reports true.
2. Observe 75 visible/healthy seconds: zero preference HTTP reads after settling,
   with at least two existing role refreshes. No new role observer/fetch or fake
   clocks. This establishes one conditional interval suppression only.
3. In a second real context, edit executive sorting via Settings. Require real
   mutation ACK, content-free preference hint, HTTP catch-up and changed select
   value in the first context. Close the producer before later phases.
4. Update only the exact seeded user to a managing foreman subscription expiring
   in 35 seconds. Require actual role HTTP grant before expiry and actual role
   HTTP denial/control removal after expiry; restore the original seeded row and
   require a fresh HTTP grant/control recovery. No preference notification stands
   in for authority and no real subscription is touched.
5. A loopback pass-through proxy drops only `/api/live` for 75 seconds; ordinary
   HTTP remains real. Require immediate catch-up and a later preference read at
   least 55 seconds into outage, plus fresh HTTP role authority and enabled
   executive editing. Restore transport and require actual ready/catch-up.
6. Terminate exactly the single private `foremanhq_change` LISTEN backend PID;
   require real false→true topic readiness and an actual preference catch-up.
   One administrator-termination FATAL is expected and separately classified;
   no unexplained SQL ERROR is accepted.

Frames are validated for content-free keys. Output retains coarse procedures,
relative request times, booleans and assertions, not SQL parameters, cookies,
queries, device addresses or full HTTP payloads. All private user state is restored
in finally; browser/proxy close, then wrapper stops Next and destroys PG, verifies
ports/PIDs gone, archives sanitized DB errors including expected FATAL distinction.
The driver has a seven-minute internal deadline; whole setup/run/cleanup is under
an eight-minute outer supervisor. No retry on a new failure. Normal runtime is
about five minutes, separate from the full matrix/idle. Unit/private-PG evidence
remains distinct from this compiled runtime proof; synthetic auth does not prove
fresh Clerk session validation. No all-polls or performance improvement claim.

The exact driver/config/dependency hash manifest will be sealed when root supplies
R12 identity and authorizes setup. This document and script are preparation only;
no server, database, compile, browser or fault has been started for R12.

## Protocol review correction: streamed reads and page ownership

Functional protocol v2 supersedes the preserved **unexecuted** v1 source under
`artifacts/compiled-preferences-functional-unexecuted-v1`. Installed tRPC 11.8.1
`@trpc/client/src/links/httpBatchStreamLink.ts` uses `jsonlStreamConsumer` and
SuperJSON, awaiting head entry → result → data. The observer now uses that same
installed decoder rather than response.json(); ordinary mutation JSON remains
supported. Parser fixtures generate actual JSONL envelopes with the installed
producer, covering deferred success/error and normal JSON. Invalid/truncated,
missing-entry, oversized and body-wait failures fail closed and are reported as
consumer observation errors rather than silently dropped.

Observed bodies have a five-second wait and decode bound, 512 KiB parse cap,
4,096 JSONL-line cap and 128-entry cap. Playwright buffers response bodies;
content-length is rejected early where present, otherwise the size bound is
applied after receipt before parsing. This is not a streaming memory guarantee.
No extra HTTP request or application cache mutation is used for observation.

Consumer/producer each own their role/preference responses, request counters and
SSE frames. Every global output row labels contextId. All readiness, role grant,
expiry/recovery, quiet/fallback cadence, producer-to-consumer hint, transport and
LISTEN assertions use **consumer** records exclusively; producer is checked only
for its own actual mutation ACK. Closed contexts cannot update live observations.
Seven node parser/context fixtures pass. The driver and both helper hashes are
recorded before/after; exact prepared hashes/dependency version are in the plan
JSON. These source checks are not a compiled-runtime pass, and execution remains
held for frozen R12 identity/static and corrected-protocol review.

## Real-server header correction after the first functional attempt

The first v2 app attempt is preserved at
`artifacts/r12-preferences-functional-2026-11-11-attempt1`; it stopped on explicit
consumer decode errors before any assertion. Installed server primary source
`resolveResponse.ts:531` streams JSONL while returning Content-Type
`application/json`. Protocol v3 therefore selects JSONL **only from the actual
observed request's `trpc-accept: application/jsonl`**, matching the installed
client. There is no body-sniffing fallback. Response Content-Type and request
transport are retained as coarse error metadata.

Ten parser/context fixtures now pass, including actual installed
`fetchRequestHandler`/`initTRPC` HTTP handling with JSONL under application/json,
streamed success/error, normal mutation JSON/HTTP 403, and a streamed BAD_REQUEST
under HTTP 200. The fixtures cover the real server response contract instead of
only a standalone producer with a hypothetical JSONL response header. The prior
failed app run and frozen v2 bytes remain unchanged. The R12 lab compile succeeded
and can be reused at `/tmp/foremanhq-speed-app-PEJvAh`, lab BUILD_ID
`UlJL743lmFp6aZ8T1n7Tg`, with a fresh private DB; no rebuild is necessary for this
observer-only correction. V3 is frozen separately; its rerun remains held pending
root review/authorization. Full matrix/idle is still held.

## V4 proxy wire observation — source only, next candidate required

Both R12 functional failures are preserved. The emitted numeric-dirname defect
requires a product fix/new candidate; no more R12 functional or full-matrix run is
planned. V4's observer preparation removes dependence on Playwright body retrieval.
A fixture using the installed streaming client confirms its fetch signal aborts
after successfully consuming a real-server result. This explains why buffered
body observation is risky, but does not retrospectively identify the retained v3
Error, whose message was not recorded.

The existing pass-through proxy forwards response chunks immediately while a
bounded data listener collects only actual role/preference/mutation-ACK bytes.
Instrumentation context/request headers map consumer versus producer requests and
are stripped before the upstream app. Reads **and mutations** are decoded by the
actual request trpc-accept contract; no method-based or body-sniffing guess.
Collectors retain at most 512 KiB wire/decoded body, five seconds of collection
and bounded official JSONL decoding, with explicit allowlisted failure reasons.
Compressed HTTP bodies honor identity/gzip/deflate/br with decompression-output
caps. SSE is neither collected nor given finite-response timeouts.

For tracked finite responses, the already-requested upstream may finish briefly
after browser cancellation so its real bytes remain observable. That changes
cancellation timing in this **non-timing protocol**; it is disclosed, not an app
transport optimization. No extra HTTP request is issued. Public producer saved UI
and consumer changed select plus actual hint remain mandatory, so server ACK
alone cannot stand in for client consumption. No cache certificates or SSE frames
are injected. All authority/cadence/reconnect assertions remain consumer-only.

Fourteen fixtures pass, including split/partial/abort/size/time/compression bounds,
stripped context tags, real server header/error contracts and the installed client
abort behavior. Syntax checks pass. This source preparation has not started an
app/browser/DB run; next candidate identity and root authorization remain required.

## Next source: R13, runtime held during canonical compile

The later R13 frozen source is
`/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r13-20261111`,
fingerprint `f680801e77896905e0ee8859a7967221c9fe12bb2b3ef79e0a9fa4aad64ebd4e`
and 2,313 files. Its canonical build identity is mandatory before any private
compile/setup. The native version fix is included in R13; neither old R12 lab is
relabelled as R13 nor its known readiness failure retried.

Before freezing v4, instrumented route continuation now preserves
`await request.allHeaders()`, including cookies/security headers. The private
proxy removes only its context/request tags. Synthetic header-preservation
fixture assertions are prepared; rerunning checks/runtime is held until the
canonical compile window ends. Subsequent private compilation will use exact
R13 identity, the same sealed auth/schema source transforms, and fresh PG; one
separate fresh functional DB will follow only after root static/protocol clearance.
The full matrix remains separately unauthorized.

R13 canonical compile/static completed, but its emitted native resolver still had
an unbound createRequire and returned null. Root therefore held all R13 private
compile/runtime. The exact prepared commands are preserved as **not run** under
`artifacts/r13-private-lab-preparation-not-run-2026-11-11`. No R13 lab was created.
The header-preserving v4 source and helpers are frozen separately with all 14
fixtures passing; corrected R14 identity/static review and runtime authorization
are still required. No full matrix or acceptance-method change occurred.
