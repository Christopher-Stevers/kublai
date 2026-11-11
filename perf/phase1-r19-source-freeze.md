# R19 exact source freeze — no build authorization

Source: `/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r19-20261111`.
Base: exact frozen R18, build
`c58613f12a7ae0590934ecdb15ddbc7a39e3a2f587f26d5f98792c92a4de64e8`,
fingerprint `ec149c2ed24935019cae5150c928b9af6606d8c41c8eba552d2a9185cf1b05dd`.
R19 fingerprint:
`4541b37e0ff7144287d9187384eeb9ae7ebe1c9aa88e31fcaa53cee03a8b05c7`
(`foremanhq-lab-source-v1`, 2,317 fingerprinted input files). The actual src tree
has 1,713 files; these counts describe different scopes.

[The manifest](artifacts/phase1-combined-r19-source-freeze-2026-11-11.json)
records exact patches, sequential pre/postimages and composition exceptions.
Only four existing runtime files change; no file is added:

| Selected commit | Runtime path | Composition |
| --- | --- | --- |
| 25d590c9 | src/hooks/use-press.ts | Hook-only attribute feature; exact R18 parent and commit postimage. |
| d5f30d71 | src/components/ui/button.tsx | Exact R18 parent/postimage; default-state optional prop only. |
| d5f30d71 | src/components/materialLists/QuantityControls.tsx | Exact R18 parent/postimage; four +/- attribute opt-ins only. |
| 51b43717 | src/app/jobs/JobsClient.tsx | Unmodified badge-only git patch applied to R18; independent R8 card attribute line excluded. |

For JobsClient, the raw commit parent differs from R18 **only** by the R8
`feedback="attribute"` line. Removing exactly that line from both raw parent and
raw postimage produces the checked R18 preimage and composed R19 postimage.
No normalization of runtime bytes is used in later measurements. The patch
itself contains only badge imports/query-options changes. PressableCard remains
byte-identical to R18; no job card opts into attribute feedback.

All 5,473 unaffected src/public/scripts/vendor files match exactly; all 3,263
public files match, including bytes outside the source fingerprint's exclusions.
Named configs/package/lock/tsconfig, dependency/server-env symlink targets,
worker/schema/PackingSlips/zoom and existing tests are unchanged. R18 has no perf
source directory; no current diagnostics/docs/operational checks are copied into
this candidate. The first helper attempt assumed that optional directory existed;
its partial copy is preserved separately. A metadata helper resume corrected
layout assumptions without recomposing runtime files; all source checks were
repeated before finalizing the manifest. No candidate was built or activated.

## Pinned command, held for root review and CPU-slot clearance

```sh
RELEASE_SOURCE_DIR=/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r19-20261111 RELEASE_BUNDLE_STATS=1 node /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r19-20261111/scripts/release/build.mjs /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r19-20261111/.next-web > /home/tim/.openclaw/workspace/releases/speed-proof-20261110/phase1-r19-build.log 2>&1
```

Use the same canonical recipe/toolchain/lock/action-key/env policy as R18. Do not
activate, modify service configuration, restart a worker or use raw HEAD.
Preserve a failed first compile and its log as a distinct result if one occurs.

## Planned proof after separate build clearance

- Production TypeScript/prerender and navigation/provider source laws; recheck
  frozen input fingerprint, all four composed postimages, unchanged full public
  corpus and production development-overlay exclusion. Record actual BUILD_ID
  and matching manifest/stats source identities; no predicted build ID.
- `static-metrics.mjs` against actual active Phase0
  `/home/tim/.openclaw/workspace/releases/speed-phase0-bootstrap-20261110/.next-canonical-a`:
  unchanged formal shared/heaviest/deploy ratchets against 502,618 / 758,531 /
  2,734,731 gzip bytes. Report the same metrics versus R18 as well, preserving
  metric definitions and final 120,000/180,000 targets.
- `check-small-change.mjs` exact completed R18 `.next-web` to R19 `.next-web`:
  count every changed emitted current script, gzip level 9, and retain the strict
  100,000 threshold. This purposeful feature batch is not a controlled inert
  edit; a failure is not reinterpreted as passing because net bytes are small.
- Inspect client stats for one intended usePress allocation in the inherited
  `app-press-browser` group and its actual consumers. Confirm the inert
  `data-press-build-probe` literal is absent from source/emitted production bytes.
  Existing four-corner probe results stay separate; no new probe build is
  authorized by this freeze.
- Reuse exact emitted native metadata-resolver inspection; verify actual native
  namespace/default binding and PostgreSQL 3.4.8 resolution, not numeric dirname
  inference. This does not start LISTEN/database/application code.
- Offline retention and compression: compare every static asset inherited from
  actual active Phase0/history, and verify current br/gz sidecars decode to exact
  emitted bytes. Record current/changed/reused script counts and public runtime
  snapshot equality. Matching HTTP/edge/functional/timing work needs its own
  coordinated slot and root clearance; no server is implied by this proof plan.

The quantity change removes visual-only React feedback commits on opted-in
buttons; badge refresh uses the reviewed cached-data policy. Neither source
change proves a latency improvement or the cause of R18's failed Office quantity
cell. Full measured gates and all earlier failures remain unchanged. No STATUS
or baseline ledger was edited.

## Canonical result (prepared only)

The first canonical build exited 0 with production TypeScript, prerender and
source laws passing. Actual build:
`47b6e70541a3f513f852e93aef05aa4f389544f72f4626082f447f53d0956ece`.
The frozen fingerprint/postimages remain exact. Formal Phase0 ratchets pass:
shared 477,538; heaviest 627,737; Phase0-relative deployment 1,322,620 gzip bytes.
Compared with R18 these are **increases** of 580 / 600 / 1,844 bytes, respectively,
not savings. Final 120,000/180,000 targets remain unmet.

Strict R18→R19 full update: **334,721 gzip bytes, FAIL** against 100,000;
42/288 scripts changed and 246 reused. This batch failure is not waived or
substituted with net-size differences or the earlier controlled probe result.

All 293 current asset Brotli/gzip sidecars decode exactly; all 1,120 raw active
static assets (including inherited history) match. Historical enumeration uses
the established helper, excluding generated sidecars. Full public source/runtime
corpus is exact at 3,263 files. One usePress allocation remains in the
app-pages-browser `app-press-browser` chunk; inert probe and development overlay
are absent. The exact emitted native metadata resolver resolves 3.4.8 through
its retained native namespace/default binding, without loading application/DB
code.

[Metadata proof](artifacts/phase1-r19-build-proof-2026-11-11.json) and
[the executed read-only inspection method](artifacts/phase1-r19-offline-proof.mjs)
record the result. The first inspection-tool invocation incorrectly expected
operational metrics scripts inside the frozen recipe; its method/log hashes and
failure are retained. The corrected inspection used existing canonical tools,
with no candidate mutation or rebuild. No HTTP server, browser, application,
database or activation ran. CPU was released before subsequent diagnostics.

## Subsequent read-only HTTP proof

After the failed diagnostic's explicit cleanup/release, root authorized one R19
HTTP proof on localhost:3150. All 293 current assets and ten actual retained
release samples passed exact Brotli sidecar/decoded-byte and immutable/Vary
checks. The current `app-press-browser` chunk was also explicitly rechecked.
Packaged SW bytes match; release manifest, health and sign-in return 200;
unauthenticated device-cache binding returns 401. All requests were cookie-free
GETs. The supervisor verified database read-only mode before startup, retained
canonical WorkingDirectory, separate background mode and BIM-disabled behavior.

The existing R18 supervisor writes logs to its on-disk four-corner proof
directory. An initial cleanup lookup used the other proof directory; the STOP
request was corrected to the configured path, with no second server or HTTP
retry. The server and supervisor exited 0, no force was needed, PID absence and
closed port were verified. No app runtime remains.

[HTTP metadata](artifacts/phase1-r19-http-proof-2026-11-11.json),
[executed supervisor](artifacts/phase1-r19-http-supervisor.mjs) and
[client](artifacts/phase1-r19-http-client.mjs) preserve exact methods/sample URLs.
No production switch, authenticated mutation, worker release or activation ran.
