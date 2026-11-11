# usePress chunk experiment — source preparation only

This is an unactivated controlled byte experiment from exact R17. Four config
unit tests and three serial canonical builds passed; full evidence and executed
methods are in [the proof directory](artifacts/use-press-four-corner-2026-11-11/provenance.json).
Root retains C as a reviewed prepared policy, but it is ineligible standalone
because heaviest grows 327 bytes versus R17. This is not release approval.
No application server, database, browser or phone workload ran.

Existing canonical R17 stats (build b1c2adf3…, client-stats.json) allocate the same
NormalModule `use-press.ts` (ID 80007, 6,978 pre-minification estimated bytes) to
25 chunks. Button (ID 85887, 3,653 estimated bytes) has those same memberships;
PressableCard (32703, 1,442) has six. live-client (75011, 8,641) has three;
device-query-cache (88467) has one. query-client is a concatenated child of
trpc/react aggregate 11560, not another physical copy. Estimates are not emitted
or additive gzip contributions, and duplicate definitions do not mean duplicated
runtime module instances.

The archived R8 controlled change measured 216,146 gzip bytes of changed chunks
in the 26-copy usePress group, within 279,829 total changed bytes. Module ID and
membership remained stable. Build-bound client/manifest/runtime changes were
separate, smaller groups; security/build bindings must remain intact. No new
measurement is made here. Root's existing rootMainFiles gzip sum is 118,373,
leaving 1,627 app bytes under the 120,000 total shared target on this graph. That
is a constraint, not a waiver.

The canonical config currently preserves Next's framework/lib groups,
20,000-byte split threshold and identifier policy. The source experiment adds
one enforced group only for the exact `src/hooks/use-press.ts` resource in the
`app-pages-browser` layer, client production only. It keeps all existing group
objects/options and identifiers, specifies minChunks=2, reuseExistingChunk and a
stable chunk name. Button, other hooks, libraries, authentication and build-ID
behavior are excluded. Unexpected pinned Next configuration fails explicitly.
The callback stays inline in next.config.js: there is no new config import that
production packaging could omit.

Authored callback tests evaluate only that method's AST with a dummy stats
observer, never the environment or application imports. They check exact
resource/layer matching, server/dev exclusion, path separators, preserved Next
objects/options, and unsupported config rejection. They do not prove webpack
allocation or byte savings.

## Required controlled proof after source review

1. Build the exact reviewed config variant through the canonical recipe; prove
   only the intended source changes and exactly one recorded allocation for the
   usePress module. Preserve framework/lib and production source laws.
2. Repeat the same small hook edit on the old and new chunk policy in separately
   pinned source identities. Count all changed current JavaScript gzip bytes,
   including runtime/manifests/build bindings: require at most 100,000. No
   normalization credit, dropped chunks or metric change.
3. Keep formal shared/screen/deploy ratchets and final targets unchanged. The
   extraction may add one initial request and changes chunk topology; a one-time
   migration itself can be large and is not a passing small-update proof.
4. Validate release asset retention/Brotli and old-client chunk availability,
   offline/visited navigation, keyboard/pointer cancellation/duplicate behavior,
   and the ordinary complete performance gate. Do not activate from a source
   test or promising net-size estimate.

No savings or interaction improvement is promised. Rollback is removal of this
one config group; no database, worker or client-state migration is involved.

## Reviewed four-corner proof plan (executed below)

Reuse only preserved exact R17 as A if its existing source/toolchain/action-key
and canonical output identity checks still match. It is not raw HEAD. Base source:
`/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r17-20261111`;
sourceBuild `b1c2adf31950c6f3db7ab189bbeabce29df5d6d9766418f3a9935bdde94f234b`,
fingerprint `be7f23501ec71b78974bc9f818fc75b46abfd0a4de0ad83288de7a49826c37cc`.
The existing A metrics are shared 478,165, heaviest 627,389 and deployment
1,324,196 gzip bytes. They are recorded evidence, not new measurements.

| Corner | Exact changes from A | Build work |
| --- | --- | --- |
| A: old policy/base | None | Reuse attested canonical R17 |
| B: old policy/probe | Only hook patch below | New canonical build 1 |
| C: new policy/base | Only reviewed next.config.js postimage | New canonical build 2 |
| D: new policy/probe | Same config postimage and byte-identical hook patch as B | New canonical build 3 |

Do not include SnapshotControls, new test/doc files, a new helper, worker changes,
or any other current checkout edits in these input trees. Callback unit tests
run against the prepared checkout separately after quiet; they are not additional
variant source inputs. The inline config needs no unshipped dependency.

### Exact inert emitted probe

The review artifact is
`artifacts/use-press-chunk-experiment-hook-probe.patch`, SHA256
`412809b976a9e8e254b9d5c1b1bdd62a06287fd273f51369e1376db249376d86`.
It adds only the inert `data-press-build-probe="r17-cache-group-control"` property
to the returned native press props, plus its TypeScript declaration. No existing
source/style selector uses that attribute. It changes no handler, callback,
permission, gesture, timing, user content or network action. Neither probe build
may ever be activated. Unlike a comment/unused export, this property should be
observable in emitted module code; verify the literal survives in both B and D
before accepting the comparison. If eliminated or transformed inconsistently,
retain that failure and request review rather than inventing a replacement run.

SHA256 pre/postimages:

- Base hook: `a2df179682c0927a8b589bfd0fee1c9c88e3eee2ee56a1395def2ae8e27f6e80`.
- Probe hook B=D: `03880145c211d93e4e8047aede9962d6eab6b023e53f5dfb5bd7ff3bc44c2e51`.
- Base config: `654a9ea44ff8d7d05497628a4b9072f398f3a62785ebfe8c522273cfc5b27f03`.
- Currently prepared new config C=D: `047f4d6aa8546b21956b5c3f9bef5a7a3e8520b1e1fd7cf4f25d4a9d6fbe7892`.

These hashes are source preparation, not approved freeze identities. Any edit to
the reviewed config/probe requires updated hashes and root review before builds.
Assert exact changed-file sets for every corner and unchanged public corpus,
package/lock/config except the intentional policy file, compiler, fixed builder
path, output path, native runtime resolution and stable action key. Source-build
IDs legitimately differ and stay in all emitted clients/bindings/manifests.

### Outputs, comparisons and decision

For every corner preserve canonical logs, BUILD_ID/source fingerprints, complete
recorded client stats, current-script list and original sidecars. Record module
IDs, layers and physical chunk memberships without counting concatenated parent
and child estimates twice. C/D must allocate usePress once; allocations of Button,
framework/lib and unrelated modules must also be reported, including unintended
movement. Existing R8 evidence supports the hypothesis but supplies no corner.

Record formal shared/heaviest/deploy metrics and their R17 deltas. Compare policy
cost C−A and D−B; retain unchanged formal Phase0/R17 ratchets and final targets.
Count rooted startup JS dependencies using the existing app/layout/jobs/layout
entry closure as a separately labelled static count. It is not an HTTP request
trace. The extra actual startup request cost remains a required separately
authorized non-timing functional/browser check after the byte result; no current
browser workload is authorized by this document.

The strict update comparisons are A→B (old policy) and C→D (new policy), using
all changed current JavaScript gzip sidecars, excluding only retained history
under the unchanged existing method. Include runtime, manifests, build-ID-bound
clients, moved/new chunks and renamed identical bytes exactly as the strict gate
does. Require C→D at most 100,000 bytes; do not subtract mandatory overhead or
normalize minifier output. Report A→C migration independently even if large;
it cannot masquerade as the small-edit result or receive a budget waiver.

Root reviews these byte gates before any further functional/latency work or
release decision. Asset URL collision checks, ten-build retention and Brotli
availability remain required through the canonical recipe, with later HTTP
verification. Full keyboard/pointer/cancel/offline/current-and-old-client behavior
and ordinary unchanged performance gates remain required. Three new builds are
the proposed bounded batch only if A is reusable and root authorizes the heavy
window; no automatic retry, policy broadening or fourth build is authorized.

Source review tightened the pinned-default guard before execution: disabled,
null, missing or empty framework/lib groups cannot silently enable extraction;
both existing predicate-bearing group objects must remain present. Matching
negative fixture cases passed in the four-test unit run. No server/dev callback branch,
framework/lib group contents, module IDs or unrelated resource matcher changed.

## Actual controlled results

All three new corners passed canonical webpack, production TypeScript, prerender
and packaging on their first attempt. Exact prepared source sets and fingerprints
matched before/after builds; no current checkout or Snapshot/R8 source entered
these inputs. Node 26.8.2, pnpm 10.11.1, Next 16.1.1, installed lock, fixed builder,
active retention source and private action key were unchanged. Reconstructing A's
private-input fingerprint matched its original BUILD_ID before each build and
after completion. The probe literal survived B and D; A and C contain none.

| Corner | Shared gzip | Heaviest gzip | Phase0-relative deployment gzip | usePress allocations | Static startup JS count |
| --- | ---: | ---: | ---: | ---: | ---: |
| A R17 | 478,165 | 627,389 | 1,324,196 | 25 | 42 |
| B old + probe | 478,246 | 627,470 | 1,324,881 | 25 | 42 |
| C new policy | 477,537 | 627,716 | 1,319,602 | 1 | 41 |
| D new + probe | 477,570 | 627,749 | 1,319,635 | 1 | 41 |

| Comparison | Changed current scripts | Complete changed gzip | Strict <100,000 |
| --- | ---: | ---: | --- |
| A → B old-policy exact probe | 30/288 | 216,161 | FAIL |
| C → D new-policy same probe | 6/287 | 24,505 | PASS |
| A → C one-time migration | 72/287 | 589,588 | FAIL; separate migration |
| B → D policy cost with probe | 72/287 | 589,621 | FAIL; separate migration |

No runtime/manifests/build bindings were subtracted. All formal Phase0 ratchets
remain passing; final 120,000/180,000 script targets remain failing. C improves
shared by 628 and Phase0-relative deployment by 4,594 versus A, but **heaviest
increases 327**. D versus B is −676 shared, +279 heaviest, −5,246 deployment.
These costs are not waived by the passing controlled-update result.

Next reallocates other modules even though the group tests only usePress.
Button grows from 25 to 33 physical chunk allocations; PressableCard remains six
with changed membership. live-client remains three and device-query-cache one.
The full named top-level inventory records 61 allocation changes, including three
ID changes and no added/removed named entries. Concatenation aggregates and module
size estimates are not additive gzip contributions. Framework/lib defaults are
preserved by source and unit checks; unrelated movement is retained in results.

The emitted app/layout + app/jobs/layout + app/jobs/page dependency union plus
rootMainFiles changes 42 → 41 files but grows 469,288 → 469,764 gzip bytes (+476).
This is a static dependency map, **not observed HTTP requests**. It does not prove
one extra request, better startup latency or an interaction speedup. New policy
startup HTTP/caching/old-client behavior still needs separately authorized proof.

Offline verification decoded every current JS/CSS gzip and Brotli sidecar
(293 assets in B; 292 in C/D), matched all 1,104 inherited historical script
bytes, and checked all 3,263 original public files in each source/runtime copy.
The source-fingerprint helper's exclusions count only 100 public files, so the
full recursive corpus was checked separately, without those exclusions. The
generated release manifest is intentionally additional. No HTTP verification ran.

Raw complete client stats (~34.5 MB each), original sidecars, logs, full manifests
and build outputs remain under `releases/press-chunk-four-corner-20261111` and the
original R17 directory. Exact paths/hashes, full allocation deltas, static maps,
source changed sets and executed diagnostic methods are archived in the proof
directory. No failed build or automatic retry occurred. The builder lock is absent;
no app/database runtime was started. Rollback remains removing only this group.
Acceptance, activation and any further build require root review.


Root approved a separate exact five-path R18 composition after reviewing this
experiment. Its canonical proof improves shared/heaviest versus R17 by 1,207/252
bytes and preserves Phase0 ratchets. See [R18](phase1-r18-source-freeze.md). The
prepared inline configuration is retained on that combined byte evidence; C stays
ineligible standalone, migration/speed/final-target failures remain unchanged.
