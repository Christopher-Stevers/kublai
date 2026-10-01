# Painted-path portal prototype: executed evidence

**Source-page correction (subsequent inspection):** the two original failures
below processed zero-based PDF page 18 (one-based 19, sheet A205), not the page
shown by the app's A511 image. That image comes from one-based page 18 / index 17
(sheet A204). The database import slot caused the offline attribution mistake;
production already selects the correct source page. Original failure records
and code remain unchanged. The separate streaming, correctly paired spatial
and external-reference studies are now executed and documented in
[the subsequent report](ROOM_SPATIAL_EXPERIMENTS_2026-10-01.md). Statements below
that describe them as proposed/not installed reflect this report's earlier state.

**This prototype is not enabled in ForemanHQ and does not establish every-room
accuracy.** It preserves the original vector commands and tests joint door/wall
evidence without room labels. Its fabricated integration fixture succeeds, but
both declared A511 attempts failed before emitting geometry. The frozen producer,
attempts, logs and private evidence are retained; neither failure was retried or
turned into an accepted completion.

The business target remains every physical room, hallway and common space.
[The live implementation and review evidence](ROOM_DETECTION_VALIDATION_2026-09-30.md)
and [the rejected domain-model result](ROOM_DOMAIN_MODEL_2026-09-30.md) describe
the available workflow and remaining accuracy gap. No complete independent
physical-room reference exists for A511, so neither model proposal counts nor
portal counts can be converted to precision, recall or zero-miss-floor success.

## Implementation

The new [vector producer](../scripts/rooms/vector-topology/README.md) uses the
installed, pinned PDF.js 6.2.108 operator stream. Public operators come from
`OPS`; the internal normalized path encoding is explicitly pinned and tested
against independently authored PDF bytes. Coordinates use the scale-one viewport
and preserve isotropic page units, rotation, transforms and curve controls.

The parser retains painted-path identity, commands, graphics state, clips, forms,
colors, transparency, paint order and reasons why evidence is unsupported. It
samples intact native curves adaptively and recognizes contiguous curved line
runs without joining gaps or separate subpaths. Later white/fill/image/unknown
paint conservatively invalidates potentially hidden evidence. Unsupported glyph
bounds invalidate earlier evidence; visibility is not silently assumed.

The portal kernel fits a quarter swing's circle center rather than treating its
endpoints as a hinge/latch pair. A witness also needs a radial leaf, two jambs and
continuing paired wall faces. Single and double swings retain supporting IDs,
residuals and unresolved reasons. Conflicting witnesses remain unresolved.
Supported evidence always requires review and carries no calibrated confidence.
Wall-band support is a local portal predicate; building-envelope extraction and
whole-floor free-space partitioning are not implemented in this prototype.

The separate [compatibility profile](../scripts/rooms/vector-compat/README.md)
tags only explicitly undefined optional fields of recognized text glyphs. A
ledger retains the original operator/glyph/field/key location and type. Absent
fields, null, path operands and numeric arguments stay distinct. Unknown values
still fail. All original parser and geometry bytes and thresholds remain frozen.
This is a separate declared study, not a reset of the first failed producer.

## Fabricated validation

The original producer passed **69** independently authored checks: 22 parser,
30 geometry, 11 lineage/resource contract and six cross-pipeline fixtures. The
compatibility profile passed another **14** checks, including an actual pinned
PDF.js worker on a fabricated Helvetica `Tj`/`TJ` document. Strict TypeScript with
`noUncheckedIndexedAccess` passes for both folders.

Fixtures cover transforms, rotations, UserUnit, colors/dashes/transparency,
forms/clipping, bow-tie clip rejection, paint occlusion, malformed operators,
intact/fragmented/false arcs, single/double doors, unequal leaves, wall/jamb
requirements, duplicates/conflicts and resource bounds. Lineage checks reject
source/archive/input changes, output tampering, copied plans, missing receipts,
alias resets, spent failures and false production promotion. The glyph fixture
reproduces the old copier's rejection, then proves optional-only normalization
works while the conservative late-text visibility gate remains unchanged.

Two separate full-CLI smoke studies were frozen before execution:

| Fabricated input | Result | Parent time | Worker peak RSS |
| --- | --- | ---: | ---: |
| Hand-authored paired wall, two jambs, radial leaf and cubic quarter swing, no font | Seven lines, one arc, one supported portal, zero unresolved | 0.615 s | 553.43 MiB |
| Same hand-authored door followed by Helvetica text | Fourteen glyphs, 28 tagged optional fields; seven lines/one arc, zero eligible and zero supported, one unresolved | 0.596 s | 551.97 MiB |

The first fixture's expected closure is the 40-point hinge-to-latch span, not the
56.6-point arc chord. The second fixture proves strict unknown-text visibility
behavior, **not absence of a door**. These tiny examples are fabricated fixture
truth, not real-sheet performance or an independent physical-room corpus.

## The two fixed A511 failures

Both attempts used the identical 36,550,826-byte PDF, zero-based page 18 (A511),
SHA-256 `17b15aed60b6b251bfe704a0c2752bab85e196ad3dcfdd2917659bd988991b4f`.
The original 15 executable/source/dependency pins are identical in both studies.
The compatibility plan separately binds six new producer pins and the original
failed plan/marker bytes. No reference polygons, labels-as-seeds, room-count
targets, presumed envelope, model outputs or protected corpus assets were used.

| Declared study | Outcome before any geometry emission |
| --- | --- |
| Original painted-path v1 | `painted-paths: unsupported operator argument object` in the strict argument copier |
| Optional text-glyph compatibility v1 | `painted-paths: path budget` at the unchanged 200,000-painted-path limit |

The fabricated font fixture and installed worker constructor identify a real
undefined-metadata compatibility gap. The separate actual pass gets beyond the
original copier failure, but this does not prove that every unsupported actual
operator value has been characterized. The later path-budget failure establishes
that this parser cannot finish this sheet under its declared cardinality policy;
it does not measure room quality or justify simply raising caps.

Neither attempt produced `painted-page.json`, `portal-evidence.json`,
`summary.json` or an accepted worker/global completion. The compatibility attempt
also produced no `normalization.json`. Failure logs and exclusive spent claims
remain authoritative. Do not report these attempts as zero detected doors or
room scores.

## Resource and provenance policy

Both parents launch a worker with a 1536 MiB heap limit, a 60-second deadline and
a 2048 MiB RSS watchdog sampled every 100 ms. Post-emission/final worker peak RSS
gates include serialization and byte verification. This is not an instantaneous
kernel memory limit. PDF input is capped at 128 MiB and each emitted file at
256 MiB; geometric cardinality/work ceilings remain unchanged.

Sources, runtime, exact input/page, resource policy and private archives are
bound before decoding. Attempt identities exclude input/output aliases; adding
prior-failure metadata cannot reset the compatibility identity. Exclusive live
parent claims and worker starts precede decoding. Initial serialized output
digests join the original plan, claim, start, worker receipt and completion;
post-write checks cannot rebaseline modified files. Failed attempts are not
consumable. Completed-result consumers inspect metadata/raw bytes without
rerunning the PDF parser or decoding native geometry.

PDF.js package/main/worker, tsx package and lockfile/runtime identities are pinned;
this is not a claim to pin every transitive dependency byte. All PDF/native data,
logs, claims, raw receipts and experiment archives remain outside Git under
`/home/tim/datasets/foremanhq-room-detection/`.

Independent metadata/raw-byte audits checked 39 pins for the original smoke and
36 for its failed actual attempt; the compatibility smoke/failed actual checked
53/65 pins, including the retained original failure lineage. The auditor did not
decode native PDF/geometry/images/models/reference labels or rerun either
producer. “Clear” refers to evidence consistency, not an accepted actual result.

| Original private record | SHA-256 |
| --- | --- |
| `vector-topology-audit/report-final.json` | `af061e56096904be98e0a2a4f8a2186b39fb68550d9492f39d0217083e946e60` |
| `vector-compat-audit/report.json` | `fde5a95b793e978ca376c1c9b00540226ada0c3fb62bce4e9d4484ddcf0db31f` |
| `vector-topology/a511-fixed-v1-20261001/plan.json` | `099782361014bc391ed2c457497ff36638c290cc2c6b83c1f74ac64ed31b1feb` |
| Original v1 spent failure marker | `52b6c44fe69348b16b70799de46cd1e1990e8b5acd11d43f21d7a3a5f2558b51` |
| `vector-compat/a511-fixed-compat-v1-20261001/plan.json` | `3f07fa410e05b5bf0ea62c7efdca1cc3823201f22ddfb449d41b68117c08cc24` |
| Compatibility spent failure marker | `4ffa91148e330163594240a8a7664bf09d6c7033a37ef0d51e0347245c4614da` |
| Compatibility retained worker log | `36e3f29e59b65d2bf2ee07054a83205d3c7896cd24a4ac8919a895f2f5d35e3e` |

Raw plans identify all original input/source/archive/claim paths and digests.
The actual compatibility attempt is
`f75fc2dd473ad1a89c9c0beac61f562005518cc88192d8b33d112437d6290469`;
the original actual attempt is
`798f5f270f1012dfb4eabdc65eb974f43d0d5c85779c9c24c708e5718f2de7e7`.
Output aliases, removed output directories or copied plans cannot reset them.

## Next accuracy work

The raw vector route needs a compact or streaming representation that retains
paint/state/provenance while handling authentic drawing complexity. It also needs
bounded text visibility and independently reviewed wall/door/envelope evidence
before geometry can partition an entire building. Corridor size, narrowness or
missing labels must never establish that an area is exterior. Filled/gray walls,
curved/mixed symbols, doorless openings and courtyard/shaft semantics remain
unresolved research cases.

Primary-source follow-up found a concrete streaming backend to investigate:
PDFBox 3.0.7's `PDFStreamEngine` reads/processes operators incrementally, and
`PDFGraphicsStreamEngine` exposes path, paint, clipping, image and inherited
glyph/state/form callbacks. [Pinned stream engine](https://raw.githubusercontent.com/apache/pdfbox/3.0.7/pdfbox/src/main/java/org/apache/pdfbox/contentstream/PDFStreamEngine.java),
[graphics callbacks](https://raw.githubusercontent.com/apache/pdfbox/3.0.7/pdfbox/src/main/java/org/apache/pdfbox/contentstream/PDFGraphicsStreamEngine.java),
[Apache license/component notices](https://raw.githubusercontent.com/apache/pdfbox/3.0.7/LICENSE.txt).
This supports a proposed adapter, not a verified ForemanHQ implementation:
intern state/clip/form records, spool chunk-hashed packed commands/controls,
retain compact bounding/style/provenance indices, and resolve later occlusion
in a second indexed pass. Unknown visibility still remains unresolved.
File-backed caching does not guarantee bounded total PDF memory.
[Official migration/IO guidance](https://pdfbox.apache.org/3.0/migration.html).

The pinned PDF.js public `getOperatorList()` waits for the last page chunk while
its page handler accumulates operator/argument arrays. Chunking the returned list
therefore does not remove its initial accumulation. A true worker-stream tap
would require a maintained internal API fork.
[Pinned public implementation](https://raw.githubusercontent.com/mozilla/pdf.js/v6.2.108/src/display/api.js).
Neither alternate backend is installed or tested here. Java/JAR/source pinning,
small-fixture geometry/visibility equivalence, a fabricated inventory exceeding
200,000 paths, exact count/chunk reconciliation and the same RSS/time budgets
must pass before any separate actual trial. This addresses runtime/representation;
it cannot establish room completeness or justify missing source evidence.

The live tap-review workflow records approvals, rejections, corrections and
missed rooms with exact drawing provenance. Explicitly complete floors, split
across independent jobs, are necessary to evaluate every-room recall and provide
supervision for the implemented warm-start adaptation tool. Partial approvals
remain useful positives; rejected/unchecked regions are not segmentation
background. A training loss, generated mask score or successful parser fixture
cannot replace that complete real-sheet test.
