# Separate actual-app Next/RSC and update smoke

Status: both fixtures compiled with TypeScript enabled. Latest bounded retry
passed five supplemental functional assertions: natural Next RSC, fresh-tab
offline replay, actual coordinator warming/draft preservation, one quiet reload
after Cancel, and byte-exact warmed assets. Earlier failed attempts remain
unchanged. No result clears a release gate. This protocol is supplementary to the
12-assertion contract smoke and never edits/replaces the sealed `25dfa8bf…`
timing method, baseline pair, candidate report, metric or gate.

The attempt's source/transform/packaging hashes and result are archived separately
from timing evidence. Both Next backends exited zero, the owned browser/proxy
closed, the private database owner exited zero and removed its socket directory,
and its PostgreSQL error summary was empty. The original driver assigned the
rejected NetworkInformation values to its report only after the guard; those
values were not captured. A subsequent reporting fix records them before the
guard and ran in later separately hashed attempts. The earlier unavailable
branch remains failed. No NetworkInformation override or production code change
occurred.

A further improvement observes natural connection capability for at
most five seconds after the offline/online scenario and new update-page load.
Every poll, elapsed time, online state, connection availability, effective type,
SaveData, downlink and individual guard criterion is retained, including a final
failure. This allows a bounded NQE settling interval; it never overwrites values
or treats simulated connectivity as a real network measurement. It ran in the
later attempts: both immediately observed eligible 4g/downlink 1.7/SaveData off.
The first attempt's rejected values remain unknown; this does not diagnose NQE
transience as their cause. Each attempt records its own supplemental method hash.

## Retained rerun and fixture observation repairs

[Rerun evidence](artifacts/next-cache-functional-r6-rerun-2026-11-11/index.json)
retains one failed source-reuse preparation, failed browser attempt 2 and passing
browser retry 3 with exact executed method variants. Preparation originally
rejected legitimate Next `[...path]` filenames using a dot-dot substring test;
the fix rejects an actual dot-dot path segment. No app/browser ran in that failed
preparation and its private DB was removed.

Browser attempt 2 repeated the two RSC assertions but failed before coordinator
proof. Local Playwright implementation calls `predicate()` without awaiting an
async wait predicate; the fixture's async cache check therefore returned early.
The repair uses bounded **Node-side awaited polling**, never a cache insertion.
It also waits for the actual update page's completed initial A-manifest response
before switching B. No production defect was inferred from the failed fixture.

Proxy Sec-Fetch-Dest counts were insufficient for controlled-document reloads:
worker-forwarded requests can have a different destination. Retry 3 instead
counts actual main-frame Playwright document navigation requests independently
of proxy observation. The changed real Job Name/dialog held the document count
at one while all 283 B assets warmed. Normal Cancel then led to exactly one
route-preserving reload (count one to two), with a further 6.5-second observation
and no extra interaction. Every warmed B asset matched its emitted hash.

Retry 3 ran 07:34:03.454–07:34:46.948 UTC on 2026-11-11. Original R6 public input
verification checked 2,278 unchanged files per fixture outside the five existing
lab transforms. Both existing compiled static maps were verified before reuse;
only generated synthetic fixtures/uploads changed for the fresh private DB.
PostgreSQL errors were zero with unchanged before/after log hash. Both owned
backends exited zero, browser/proxy ended, and the private socket was removed.
Waiting-worker activation, chunk failure, all pending-work signals, real Clerk,
physical performance and the full regression gate remain separate requirements.

## Frozen inputs and explicit differences

Use exact frozen R6 source/build, `c49e8cba…`, fingerprint `3d4e7376…`. Create two
fresh marked app copies using the existing **sealed** `create-lab-snapshot.mjs`
inside a fresh private Unix-socket database from the sealed lab helper. Do not
copy current HEAD or use the production environment/database. Original R6 public
inputs are verified before transforms and again before/after the smoke.

Retain only the established lab changes: generated Next webpack Clerk aliases,
synthetic Clerk client/server auth modules; private-socket connection constructors
in the three existing DB/background files; generated TypeScript include config;
and the lab-only attestation route. No application provider, worker, route card,
router, update coordinator or release-safety implementation is patched. The
driver verifies production module parity, rechecks every original public input
outside the existing five declared transforms and records each transformed file
and auth-module hash. The synthetic seed user still passes normal application
identity, organization and permission code; this is **not real Clerk evidence**.

Record the sealed helper/auth/seed/schema/preflight hashes alongside the new
driver/supervisor hashes as this protocol's own method provenance. Existing
fixture randomness belongs to that attempt's fixture record, not an invented
canonical production identity. Preserve generated source trees and build logs,
including failures, until their evidence is archived.

For each app copy compile with `RELEASE_BUILD_ID` and `NEXT_PUBLIC_BUILD_ID` set
to the same deterministic, distinct 64-hex **fixture** identity. The frozen Next
config already reads `RELEASE_BUILD_ID`; do not add a build-ID config patch.
Keep background mode `separate`, BIM disabled, fake lab payment/auth keys, and
the validated private socket environment. Clear inherited dist/config/runtime
overrides. Keep TypeScript checks enabled. These fixture builds are neither
canonical R6's byte identity nor comparable timing captures. Their identities
should bind the focused method/packaging hashes and original R6 fingerprint.

Do not copy canonical runtime/public's chunk map into these builds. The driver
walks each actual compiled static directory, hashes emitted JS/CSS and builds its
own exact manifest. The owned loopback proxy retains the union of A/B asset bytes
and refuses identical URLs with different bytes. It serves the unchanged R6
worker and each active fixture's generated manifest; other requests go to that
fixture's Next server. Proxy packaging is an explicit difference from the
production immutable/Brotli wrapper, whose earlier HTTP proof remains separate.

## Source-confirmed real navigation and UI

Direct-load `/jobs/<seed jobId>`, not `/jobs`'s local-history JobsClient flow.
The actual `src/app/jobs/[jobId]/page.tsx` Rooms option calls Next
`router.push('/jobs/<id>/rooms')`. Its real card selector is
`[data-job-card="rooms"]`. The destination is a reviewed worker route. The
existing synthetic seed has no rooms; the actual destination UI must display
`No rooms yet.` (possibly followed by its upload guidance).

The driver requires a naturally generated nonprefetch RSC response from that
click. If no response occurs, this scenario fails; a URL change alone does not
count. It closes that tab and opens a fresh controlled tab at the same job
overview to exclude reuse of the old tab's in-memory Next router state. It then
sets that isolated browser context offline and clicks the actual Rooms card.
Success requires a real 200 RSC response marked `fromServiceWorker`, the expected
destination UI and zero additional origin RSC requests. No forged RSC headers,
manual router calls, cache insertion or key substitution is allowed. If natural
router-tree keys differ and replay misses, preserve that failed result.

For the update branch, use the actual overview's **Edit job** button, actual
`Job Name *` input and **Cancel** button. Change the input but never save it.
Switch only the owned proxy's backend/manifest to B. A dispatched visibility
event explicitly stimulates the normal coordinator's resume listener (not a
trusted warm/activation message); report this event stimulation as a fixture
difference. Require the browser's actual good-link/no-SaveData capability; do not
override NetworkInformation to manufacture a pass. The actual coordinator must
fetch B's map and warm all B bytes while the draft/dialog holds reload. After
ordinary Cancel, the DOM/quiet checks must reschedule exactly one reload,
preserving the overview route, without another pointer/key action. Verify every
warmed asset against B's emitted bytes. Chat is deliberately excluded: its
visible textarea conservatively blocks reload even when empty.

This does not exercise every private queue/upload/pending mutation guard. It does
not change worker bytes between A/B, so waiting-worker activation is unproved.
Chunk failure, cold private HTML, account transitions and role hints are not
silently inferred from this scenario; the earlier synthetic contract and unit
tests remain separately labeled evidence.

## Caller-owned preparation and bounded execution

The next authorized execution must use an owning launcher with `finally`/trap:

1. Freeze the new driver/supervisor, sealed helper provenance and source R6.
   Start a fresh private lab database and seed it using the sealed lab helper.
2. Create two marked snapshots and compile separately. Allow at most 600 seconds
   per build under an owned process-group timeout, with a 10-second hard-kill
   fallback. Archive logs and exact generated transformations even on failure.
3. Start only those two Next servers on explicitly reserved unused loopback
   ports. Allow 30 seconds for health, then run the normal 14 read preflight
   against each synthetic server. Record schema inventory and zero DB errors.
   Record each actual server PID, source cwd, build ID and private socket binding.
4. Supply a private input file as below, then run
   `NEXT_CACHE_FUNCTIONAL_INPUT=<file> node perf/next-cache-functional-supervisor.mjs`.
   That supervisor creates a unique attempt directory, owns a new process group
   for the driver/proxy/new Chromium profile, and kills that group after 240
   seconds independently of cleanup promises. Per-step limits are 5 seconds for
   attestation/binding, 10 seconds upstream, 15 seconds for ordinary UI/RSC, 30
   seconds for initial document, 70 seconds warming and 20 seconds reload.
5. Always stop/wait both owned Next PIDs and stop/remove only the newly created
   private PostgreSQL cluster. Preserve fixtures/source/build logs/reports on
   failure. The browser supervisor intentionally does **not** kill caller-supplied
   server/database processes. No existing browser contexts, live app symlink,
   production service, phone/ADB or production DB may be touched.

Private input shape (fill only from this attempt's resources):

```json
{
  "protocol": "next-cache-functional-v1",
  "productionDatabase": false,
  "frozenR6": "<exact frozen R6 source root>",
  "privateSocket": "/tmp/foremanhq-perf-pg.<owned>",
  "variants": [
    {"root": "/tmp/foremanhq-speed-app-<A>", "dist": ".next", "pid": 123, "base": "http://127.0.0.1:<A>/"},
    {"root": "/tmp/foremanhq-speed-app-<B>", "dist": ".next", "pid": 456, "base": "http://127.0.0.1:<B>/"}
  ]
}
```

The driver checks `/proc` cwd and environment against the marked fixture and
private socket before/after. It records hashes/booleans rather than environment
values. A port is caller-supplied for its co-started PID; the check does not claim
a kernel socket-to-PID attestation. The final report keeps all assertions,
actual capture times, source/transform/packaging hashes, RSC tree hashes, request
counts, browser identity and DB health. Every attempt retains raw stdout/stderr
and report, including incomplete worker output. Any failure remains a failure;
there is no sample filtering, automatic retry or activation path.

Even a complete pass is functional evidence for these cases only. R6's failed
job-opening regression cells and missing final Phase0/field requirements remain
release blockers under their existing rules.
