# Proposed isolated browser proof for private cache and updates

Status: first contract slice executed; 12 prepared assertions passed on attempt 3.
The first slice remains a synthetic contract. A later separate actual-app smoke
has executed the Next/RSC and coordinator scenarios described in
[its protocol/evidence](next-cache-functional.md); real Clerk and release gates
remain unproved by either smoke. This is a separate
functional protocol, not a modification of the frozen `25dfa8bf…` timing method.
It cannot be used to retrofit a successful full-matrix result.

## Executed first contract slice

`private-cache-contract.mjs` and `private-cache-contract-entry.tsx` prepare a
bounded supplemental contract smoke using the actual frozen R6 provider,
QueryClient, IndexedDB stores/account fences and unchanged production worker.
Only PDF/text rendering cleanup and the loopback synthetic session/binding/read
endpoints are substituted. There is no database or personal browser connection.
The runner verifies R6 build/fingerprint metadata, hashes loaded frozen modules
before/after, records driver/entry/lock/tool versions, and creates its own two
valid-hex compiled variants and manifests from their emitted bytes.

Once execution is separately cleared, run from the repository:

```sh
node perf/private-cache-contract.mjs > /tmp/private-cache-contract-report.json
```

The default source is the frozen R6 snapshot. `CONTRACT_R6_SOURCE` may only point
to another copy with the same expected R6 metadata; it does not select arbitrary
HEAD. The runner uses an ephemeral loopback port, a newly launched headless
Chromium/context, a disposable directory and a 180-second watchdog. It closes
only those resources. It writes a supplemental report to stdout and removes its
temporary emitted files/metafiles; report hashes preserve the tested identities.
An outer supervisor creates a new owned process group and kills it at the hard
180-second deadline independently of browser/server cleanup promises. It keeps
each attempt's stdout, stderr and report in a uniquely named temporary attempt
directory, including failed setup/compile attempts, and removes its runtime
subdirectory. No failure is silently retried or replaces an earlier report.

Executed assertions cover actual registration/control/provider binding;
synthetic visited nonprefetch Flight replay scoped by tree/account/build;
old-account in-flight response fencing; terminal refusal locking a second tab;
logout; failed changed-asset fetch; exact-byte warming; malformed manifest
rejection. [The supplemental report](artifacts/private-cache-contract-r6-2026-11-11.json)
records Chromium 152, exact source/build/module hashes and all 12 results. The
first two failed attempts remain in uniquely named external attempt directories;
the report preserves their failure reasons. [The attempt archive](artifacts/private-cache-contract-r6-2026-11-11-attempts/index.json)
contains all three runner/entry variants, reports, stderr and original evidence
hashes. The first variant is explicitly reconstructed from the controlled edit
history because that attempt exited before emitting its own source hash;
variants two and three match their captured hashes. Their fixture transport reused one
URL while deliberately holding a response, blocking a later same-URL request.
The first also lost its complete worker report when that pending promise rejected
during cleanup. The corrected fixture handles the promise immediately and gives
synthetic requests distinct `_rsc` values; the unchanged worker strips `_rsc`
from its account/build/tree cache key. No production source was changed.

A success is explicitly only a
partial contract smoke: the synthetic RSC fetches deliberately set their own
headers and do not demonstrate naturally generated Next router compatibility.
The registration/update coordinator is not included, so automatic quiet reload,
chunk-failure recovery and cold private HTML authentication remain unproved by
this first slice. Build-scoping checks establish the actual valid-build key;
they do not yet exercise a new document refusing a mismatched server build.
Real private-store modules initialize, but this slice does not populate and
revoke a saved drawing/PDF or persisted TanStack query row. Existing focused
store tests remain separate evidence. The fuller actual-app scenarios below
remain separate work.

## Why the current matrix is insufficient for these paths

The frozen full-baseline script sets `NEXT_PUBLIC_BUILD_ID` to the nonhex
`isolated-speed-baseline` (the pilot uses `isolated-speed-pilot`). Production
DrawingAccountProvider sends a private service-worker binding only for a valid
64-hex build; release reload guards also require a valid build. Therefore these
lab environment settings skip production private Flight binding/update paths.

The canonical builder generates `/foremanhq-release-assets.json` only in the
packaged build's immutable `runtime/public`. R6 source `public/` has no generated
manifest. Stock lab `next build`/`next start` does not perform that packaging, so
it also lacks the actual changed-asset manifest unless a separate fixture step
provides it. Canonical R6 HTTP proof already verified its packaged manifest 200;
this is a lab coverage distinction, not a production packaging failure.

## Minimal inputs and provenance

- Clone exact frozen R6 public source into a disposable `PERF_LAB_ONLY` tree.
  Record canonical sourceBuild/fingerprint separately from fixture builds.
- Declare a new focused protocol and hash its driver, fixture configuration,
  auth aliases, packaging code and all additional transforms. Preserve original
  source/copy verification. Record Chromium/Node versions and actual results.
- Use a fresh Unix-socket synthetic database and synthetic accounts A/B. Reuse
  normal R6 identity, access checks, binding API, client provider and worker.
  The only auth substitution is the declared isolated Clerk alias; it supplies
  test sessions to normal server checks, not trusted cache-binding messages.
- Compile two fixture variants with distinct deterministic 64-hex build IDs.
  Set both Next BUILD_ID and NEXT_PUBLIC_BUILD_ID to each fixture ID so binding
  API, document scripts and manifest agree. These are fixture IDs, not claims
  of byte-identical canonical production builds.
- Generate each manifest from its own actual stubbed compiled JS/CSS. Variant B
  serves the exact retained A assets plus B assets. Use the pinned production
  worker and static-handler/start-wrapper code with a disposable working
  directory, separate background mode, BIM disabled and a unique loopback port.

**Do not copy canonical R6 runtime/public straight into the stubbed build.** Its
manifest lists canonical chunk URLs/hashes, which differ from auth-stubbed lab
chunks. Copy source public assets if needed, then generate the focused fixture's
manifest from that fixture's emitted bytes. Never copy production environment
files or private data. Never activate a lab artifact or change the live symlink.

## Small real-Chromium scenario set

1. Start A, establish normal synthetic sign-in, and wait for actual worker
   control and a successful server-validated account/build binding. Warm a
   reviewed private route using real navigation, not direct Cache.put or forged
   Flight responses. Open a fresh controlled tab online at the same starting
   route to exclude an already-warm client-router memory hit; only then go
   offline. Navigate to the warmed route and assert actual worker-served RSC,
   expected synthetic UI and no origin request. Require the naturally produced
   router-state key to match; do not forge RSC headers to manufacture a hit. A
   different route-state key leaves that replay case unproved. Cold private HTML remains
   server-authenticated and must not replay when offline or signed out.
2. Exercise account A→B, logout and an authoritative access refusal through the
   normal fixture session/API flow. Confirm old clients/scopes cannot replay A
   payloads or rebind from stale messages, including a second open tab. No
   test-only shortcut may grant a private binding without the real binding API.
3. Keep A's tab open while swapping only the disposable origin to B. Require
   browser-reported good-link/no-SaveData conditions, or explicitly label any
   controlled NetworkInformation override as simulation. Observe the normal
   manifest fetch and worker warming only missing changed fixture assets.
   Confirm cached bytes match B's emitted bytes. Hold a real unsaved draft and
   verify no automatic reload; clear it through normal UI, then verify quiet
   rescheduling without another pointer event, one reload, preserved route and
   no repeated reload. A separately declared inert worker-comment variant can
   exercise the real waiting-worker activation branch without changing logic.
4. Inject one missing-chunk response at the disposable origin, not a deletion
   of canonical files. Confirm same-screen recovery is bounded to one reload
   and respects offline/draft/pending-work safeguards.

Report each assertion and branch separately. Missing worker control, unavailable
link capability, wrong manifest or an unexercised branch is a failure/unproved
case, not an inferred pass. Keep synthetic response contents out of the summary;
record source/method hashes, booleans, request classes/counts and byte hashes.

## Limits and cleanup

This proves browser wiring and isolation for those paths, not physical frame
latency, final speed targets, real Clerk cost, full offline convergence, every
job-role hint, or a full candidate regression comparison. A full timing-method
change instead requires a new named version and fresh baseline pair.

Always close only created tabs/contexts, terminate the two disposable origin
processes, stop/remove their private database, and remove test directories and
port mappings. Preserve immutable inputs/reports and failure evidence. No live
DB writes, phone/ADB interaction, service restart, worker release or activation
is part of this proposal.
