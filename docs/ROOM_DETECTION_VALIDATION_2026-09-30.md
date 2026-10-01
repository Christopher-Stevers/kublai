# Room completeness and review: implementation evidence

The goal is every physical interior space, including rooms with no readable name,
corridors and common spaces. The implemented detector no longer depends on a text
label to propose an enclosure. **The goal has not yet been achieved on construction
sheets.** Generated corpus scores and successful application tests are separate
from that claim.

## What is implemented

- Independent enclosed-space discovery, diagonal/rotated wall support, corridor
  holes, bounded boundary expansion and protection against the sheet background
  becoming a room. Apartment occupancy descriptions remain unit context rather
  than physical room anchors.
- PDF text-paint operators are filtered as well as canvas text methods. This
  prevents glyphs rendered as vector paths from becoming tiny enclosures. The
  synthetic production PDF regression went from eight candidates to its two
  actual rooms, without deleting wall vectors.
- Managers can tap a proposal, approve, disapprove with an optional reason,
  repair its outline, undo a decision and add a missing room. An explicit entire
  floor check is required before floor confirmation. No proposal is automatically
  approved because of a score or detector result.
- The old unreviewed persistence paths were removed. Cached clients and queued
  legacy method names use the same reviewed pipeline. Manual tracing retains its
  geometry algorithms but no longer parses or caches unnecessary text anchors.
- Reviews store immutable proposal/correction geometry and drawing provenance.
  Reruns retain approved and manually corrected boundaries, suppress equivalent
  rejected proposals on the same input and hide obsolete pending proposals.
  Repaired boundaries can be proposed again. Reviews and edits reject stale
  versions and invalid/self-intersecting geometry.
- The organization-scoped feedback model prioritizes review after sufficient
  examples across multiple floors. It is not calibrated detection confidence.
  Invalid boundaries receive highest review priority immediately.
- Private exports copy exact drawing inputs and review snapshots. Real-sheet
  evaluation checks hashes, uses the production PDF preprocessing, groups splits
  by job and never calls a model provider. Unreviewed pixels are unknown;
  rejected/merged proposals are not background segmentation labels.
- A floor becomes dense training/reference data only after every current
  proposal is reviewed, missing rooms are added and a person explicitly checks
  completeness. Legacy confirmation does not imply that annotation is complete.

## Frozen geometric benchmark

Dataset: generated monochrome renders of Modified Swiss Dwellings room-area
geometry, 1024-pixel long side, four-pixel closed boundaries. Corridors, stores,
stairs and elevators are included; shafts, balconies, terraces and outdoor areas
are excluded. Development and holdout sites are disjoint. No ground-truth label
anchors were supplied to these runs.

| Measure | Development | Protected holdout |
| --- | ---: | ---: |
| Layouts | 120 | 120 |
| Reference spaces | 4,369 | 3,525 |
| Correct matches at IoU 0.50 | 4,089 | 3,273 |
| Missed spaces | 280 | 252 |
| Extra candidates | 295 | 270 |
| Recall | 93.59% | 92.85% |
| Precision | 93.27% | 92.38% |
| F1 at IoU 0.50 | 93.43% | 92.61% |
| F1 at IoU 0.75 | 93.18% | 92.61% |
| Worker failures | 0 | 0 |
| Median / p95 process latency | 1.411 / 1.724 s | 1.291 / 1.709 s |

Authoritative local reports are under
`/home/tim/datasets/foremanhq-room-detection/all-spaces-msd/`:

- `run-20260930-132709-development-none/report.json`
- `run-20260930-133510-holdout-none/report.json`

The protected holdout was inspected once after freezing the geometric candidate.
Do not use its misses to retune this candidate. Reports record source hashes.
These renders do not contain authentic door symbols, fixtures, annotations,
revision clouds or scanned text. Their scores do not establish live-sheet recall.
The zero-label legacy baseline yields no proposals because its design requires
labels; that comparison demonstrates a coverage limitation, not an independently
measured construction-sheet accuracy improvement.

## Real drawing evidence and rejected approaches

A read-only full-resolution production-pipeline probe on the difficult sheet
returned 128 proposals, 116 without physical labels. Of 53 extracted text
anchors, 20 were apartment occupancy descriptions; only 33 were retained as
possible physical room labels. Nineteen physical anchors remained unresolved.
Anchor counts are not reference room counts and cannot be converted to recall.

The probe stayed within the four-GiB worker budget (peak RSS about 2.63 GiB).
Visual inspection still found missing rooms, furniture/fixture enclosures and
revision-cloud divisions. One proposed contour was self-intersecting; it requires
manual repair before approval. No complete reference annotation exists for this
sheet, so precision, recall and the fraction of entirely correct floors are
currently unknown.

The following experiments were rejected as defaults:

- Raw vector strokes generated 1,086 candidates, largely fixture/annotation cells.
- Paired/graded wall vectors generated 438 candidates with similar clutter.
- Unrestricted isotropic closure leaked room partitions into the page background.
- Always using the shortest gap closure missed many real door enclosures.
- Larger gap closing recovered more text anchors while increasing invented
  divisions; a text-anchor improvement alone does not justify promotion.

The custom segmentation challenger and its source/data licensing analysis are
tracked in [the model research decision](ROOM_DETECTION_MODEL_RESEARCH_2026-09-30.md).
Keep its training, validation, checkpoints and predictions outside Git. Existing
MSD development and protected holdout sites must remain excluded from training.
A successful training run is not grounds to replace a detector; compare complete
room matching and real-sheet failures before promotion.

## Local structural-model pilot

A separate compact RGB U-Net challenger has actually been trained on this
machine from random weights. It predicts interior, boundary and opening closure
maps, blends overlapping tiles and polygonizes one global page graph, retaining
holes. No checkpoint has been enabled in the application.

The pilot has 1.964 million parameters and used eight epochs, 108.5 seconds and
about 980 MiB peak allocated GPU memory. Eighty training layouts and twenty
validation layouts exclude all 89 sites reserved by the existing MSD geometric
development/holdout corpus. Inputs contain procedural door gaps, thin/gray walls,
fixtures, text, grids and colored annotation clouds. They are simulated drawings,
not original construction sheets.

On the same twenty new validation layouts (698 spaces):

| Measure | Structural pilot | Geometry baseline |
| --- | ---: | ---: |
| F1 at IoU 0.50 | 91.30% | 54.33% |
| Recall | 87.25% | 43.12% |
| Missed spaces | 89 | 397 |
| Extra candidates | 27 | 109 |

The pilot's F1 at IoU 0.75 is only 74.66%; it still has sixteen merge and two split
failures. The result supports further model experiments, not production promotion
or a claim about customer-sheet accuracy. Its validation loss was used to select
a checkpoint, so this is development evidence rather than an untouched final
model test. The training/validation manifest, checkpoint and report are retained
privately under `/home/tim/datasets/foremanhq-room-detection/models/`.

The first pilot was also tested against A511 at native 5000-pixel resolution.
It produced 436 proposals, including a giant sheet-background component,
parking/landscape cells and merged apartment rooms. It was rejected for deployment.

## Whole-sheet context challenger

A separate 2.456-million-parameter model combines a whole-page overview with
coordinate-aligned native tiles. It trained for twelve epochs in 174.95 seconds,
using 1,434 MiB peak allocated CUDA memory. Its new procedural sheet corpus has
multiple building wings, courtyard/parking areas, title blocks, dimension bubbles,
paired gray wall faces and door gaps/leaves/arcs. Training and validation exclude
all 89 sites protected by the geometric benchmark.

On twenty new development pages containing 1,321 reference spaces, all three
candidates used identical frozen input and target bytes:

| Measure | Context model | First pilot | Geometry |
| --- | ---: | ---: | ---: |
| F1 at IoU 0.50 | 75.45% | 65.08% | 60.02% |
| Recall | 76.53% | 78.73% | 50.11% |
| Missed spaces | 310 | 281 | 659 |
| Extra candidates | 348 | 835 | 223 |

The context model's F1 at IoU 0.75 is 59.25%, with 62 merge and 20 split failures.
Its interior pixel IoU is 91.87%, but opening-closure IoU is only 11.18%.
Pixel accuracy therefore does not establish correct room partitioning. The
authoritative report is `models/eval-context-20260930/report.json` under the
private dataset directory.

The frozen per-floor report also exposes the business requirement more directly:
the context model misses at least one space on all twenty development floors.
At IoU 0.50, the first pilot and geometry each have only one floor with zero
misses; none of the three candidates has a floor with both zero misses and zero
extras. These are derived aggregates of the same development report, not another
holdout inspection. The source report SHA-256 is
`a0766fb1cdcb4dc88946d60920694f85532d734a65da975243bd6b6f6bc624b1`.
`report_completeness.py` computes these measures without rerunning detection.

On A511 it produced 191 proposals in 7.35 seconds. Context removed the giant
page-background and major parking false positives, but unit/washroom merges,
missing spaces and fixture fragments remain. It is also rejected for deployment.
Further native wall, portal and occupancy experiments are tracked in the
measured model report below. No neural model is enabled in the application.

## Further model trials and unseen-site result

Longer training improves synthetic precision and boundaries but does not solve
actual-sheet coverage. Six predeclared barrier/occupancy/area/core settings were
compared on the same development pages. Bounded occupancy clipping creates a
large merged building outline on A511 and is rejected. The development-selected
plain 0.4 barrier setting produces 59 A511 proposals, still missing west/north
rooms and merging apartment spaces; it is also unapproved.

After that selection was frozen, one new generated corpus excluded all 153 sites
used by prior training, validation or protected evaluation. Twenty distinct new
sites contain 1,165 spaces. The selected model has 81.29% recall, 88.75% precision,
84.86% F1 at IoU 0.50 and 74.19% F1 at IoU 0.75: 218 missed spaces, 120 extra
proposals, 37 merge candidates, six split candidates and zero execution failures.
It recovers **zero entire floors without misses**, at both IoU thresholds. This
one-time result is synthetic evidence; it must not be used for further tuning.
The exact selection, sources, manifests and private report checksums are in
[the measured model report](ROOM_DETECTION_MODEL_PILOT_2026-09-30.md).

The separate [promptable-model trial](ROOM_PROMPTABLE_MODEL_RESEARCH_2026-09-30.md)
uses simulated human taps/boxes on development drawings. Those can improve small
drafts, but the actual hallway remains fragmented and loses branches. It stays
offline. Per-room review, explicit tracing and verified correction exports are
the production path while more complete real-sheet references are built.

The separate [local vision census](ROOM_VISION_CENSUS_RESEARCH_2026-09-30.md)
also fails: Qwen3-VL-2B produces no accepted response on any of eleven viewports
in either the greedy trial or its single declared sampling control. Repeated
coordinate grids, token-limit loops and invalid objects are preserved as
failures. Those points are not room boundaries, and no census model is enabled.
The hardened reusable harness requires complete model/source/input provenance
and finalized inference evidence before decoding scoring targets.

A [marker-based partition challenger](ROOM_PARTITION_CHALLENGER_2026-09-30.md)
reuses the frozen learned maps on the original development pages. Its declared
hierarchical setting improves recall from 78.65% to 86.75%, reducing misses from
282 to 175, but raises extras from 85 to 134 and splits from two to 48. Only three
of twenty floors have no misses at IoU 0.50, and none has both zero misses and zero
extras. A511's qualitative probe recovers substantial wing structure and the
east hall without a giant merged building, but retains exterior false rooms,
fixture holes and fragmented circulation. It remains offline. The previously
exposed twenty new sites were not reopened or used to tune this experiment.

## Genuine-wall and opening data

The [original Swiss geometry import](ROOM_TRUE_OPENING_DATA_2026-09-30.md)
adds a separate 80-training/20-development corpus from 100 previously unused
site components, excluding all 173 sites used by earlier experiments. Targets
use original wall, column, window and door footprints. Adjacent open functional
areas do not acquire an invented wall. Small spaces, stairs, elevators and
common areas remain included; undefined source areas remain unsupervised.

V4 adds nine deterministic wall styles, including weak gray fills and paired
one/two-pixel outlines, plus explicitly simulated furniture and stair treads.
The complete 100-case comparison verifies unchanged site/split/source identities
and byte-identical targets, masks, overviews and references relative to v3;
only images change. All 400 private assets validate, seventeen fabricated tests
pass and independent style/provenance audits pass. Two current unprotected
renders passed visual QA. This establishes data integrity, not room accuracy.

Original geometry supplies better structural supervision than randomly cutting
doors into closed room-area outlines, but it does not supply original drawing
images or independently annotated physical-room instances. This corpus remains
ineligible for every-room F1/recall or whole-floor success claims. Any paired
model test can report masked structural-pixel diagnostics only; A511 still
requires complete real-room annotation before an accuracy claim.

The fixed 48-epoch random-initialized trial completed in 592.45 seconds and
selected epoch 47 by development loss. On the same twenty known-pixel
development cases, interior/boundary/opening IoU changed from
44.15%/40.02%/1.88% for the earlier model to 92.40%/86.38%/61.71%.
The earlier model learned centerlines and artificial gaps, while this test uses
actual physical footprints; these results measure target adaptation, not room
accuracy. Sources, assets, runtimes, checkpoints and emitted caches are fenced.

Both fixed A511 probes remain rejected: plain extraction produces 543 proposals;
the existing hierarchical partition produces 395 proposals and 2,079 holes.
Visual inspection finds substantial wing/north room structure but also false
parking/exterior/title-block partitions and revision-cloud/fixture holes.
The higher structural-pixel scores do not justify enabling this model.
Full experiment evidence is in
[the true-opening model report](ROOM_TRUE_OPENING_MODEL_2026-09-30.md).

One fixed head-composition experiment then retained the earlier model's interior
and substituted only the true-opening model's boundary/opening heads, with the
existing hierarchical partition unchanged. On the same twenty exposed procedural
development pages, IoU0.5 recall regressed from 86.75% to 53.97%: misses rose from
175 to 608, extras from 134 to 1130 and split candidates from 48 to 348. All twenty
pages completed and all 1321 references remained in the denominator. No floor had
zero misses. This combination is rejected, without retuning or promotion.

The cached-map-only A511 probe produced 337 unapproved proposals, 258 retaining
holes. Visual inspection still finds object-shaped holes, fragmented circulation
and false outlines in projecting/diagonal edge areas. No complete real-sheet
reference exists, so these counts establish neither accuracy nor completeness.
Fourteen fabricated integrity tests and an independent completed-evidence audit
pass; full findings are in
[the fixed structural ensemble report](ROOM_STRUCTURAL_ENSEMBLE_2026-09-30.md).

## Scale, domain and topology diagnostics

A separate CPU-only measurement inspected the original twenty exposed procedural
development sheets and the original Swiss eighty-training/twenty-development
renders. It performed no inference or training, and opened no protected or newly
reserved development drawings. Native target-barrier diameter proxies have
medians of four pixels on procedural sheets and ten on Swiss training renders;
opening-span proxies are 15.30 versus 37.12 pixels. Target definitions also differ,
so these are raster-support diagnostics rather than physical wall measurements.
Nonstructural-ink proxies are denser on procedural sheets, and all twenty are
chromatic versus none of the hundred Swiss renders. This supports a separate
scale/clutter data experiment; it does not prove which difference causes failures.

Four fabricated checks and an independent metadata/byte-chain audit pass. See
[the scale/domain diagnostic](ROOM_SCALE_DOMAIN_DIAGNOSTIC_2026-09-30.md) for
coverage, formulas and limitations. Its private report SHA256 is
`dacca3a4d6fc154bf04d5af34a43892344035e2ff51ee0aad76a3a93be85058e`.

A read-only A511 vector-graph probe also demonstrates why exporting every legacy
graph face is inadequate. It retains 19,886 strokes, produces 1,812 faces and
1,596 candidate spaces, including 756 not marked outside. These are graph
partitions, not physical-room counts; fixture and annotation enclosures remain.
Ten of thirteen corridor-like faces are marked outside by current heuristics.
The probe finished in 3.87 seconds at about 1,394 MiB RSS and made no application
or review changes. The private count report SHA256 is
`5902f0c4f994ec41ccbf0cbcd0979048ba9933c4e1973e20f2845506d443b43b`.
Geometry-aware wall/jamb/door topology remains a possible complementary research
direction, with no claim that this graph is ready for production.

The [fixed scale-and-sheet corpus](ROOM_DOMAIN_SCALE_DATA_2026-09-30.md)
subsequently completed its one declared CPU build in 50.92 seconds. It retains
the same hundred Swiss source floors and 80/20 split, with balanced isotropic
densities .4/.7/1.0, dense fixture loops, known-negative parking motifs and colored
revision clouds. Rational pixel-cell transforms preserve physical/opening support;
mixed interiors and any source-unknown contributions remain unsupervised.
No provisional room-truth arrays are read or emitted. All hundred native/coarse
arrays pass byte, dimension, binary-mask, opening-subset and nuisance checks;
two fixed unprotected visual samples pass clipping/placement inspection.
Twenty-one fabricated builder checks, three QA checks and independent source and
completed-byte audits pass. This establishes a verified experimental corpus,
without room-accuracy or completeness claims. Model testing remains separate.

## Application verification

The production build, TypeScript checks, 258 tests across 50 files and lint with
zero new errors pass. A disposable restored database verifies stale review/edit
checks, exact edit-response versions, organization/role isolation, correction
history, approval preservation, rejection memory, drawing identity/content
fencing and explicit floor completeness. The fifteen-check phone browser exercise verifies
real touch selection, approval/disapproval, undo, reload persistence, corner
editing, two consecutive saves, concurrent-edit recovery, adding missed spaces and full-floor confirmation. Approval controls and
the drawing are visible together at 390×844 pixels. Anonymous dashboard access
redirects to sign-in; an identical drawing URL is denied after its cloned job
moves to a foreign organization.

Edits retain their own transaction's version rather than adopting a potentially
newer refetched version. Additional corner edits wait while a save completes;
external changes expose a reload action. These are application integrity checks,
not measurements of detection accuracy.

## Reproducible feedback loop

See [the evaluation instructions](../scripts/rooms/complete/README.md). Freeze a
private export, run baseline and candidate on identical development drawings,
inspect per-floor misses/extras/merges/splits, and run an untouched held-out job
set only after freezing the candidate. Preserve full floor completeness, source
hashes and independent annotation provenance. Partial positive reviews can test
whether accepted rooms are recovered, but they cannot establish all-space recall.

Future promotion must measure corridor/small-space recall, false proposals per
sheet, the fraction of floors with zero missed spaces, boundary IoU, review time,
latency and failures. Acceptance should require improvement on real sheets
without losing previously correct rooms or raising the review burden.

The [verified review adaptation tool](../scripts/rooms/adaptation/README.md)
now warm-starts the fixed completed long48 checkpoint rather than random weights.
It regenerates approved geometry supervision from copied immutable review
evidence, requires separate reviewed training/validation jobs and retains the
original synthetic replay. Rejected and unchecked areas are unknown; reviewed
opening supervision is also unknown. Twelve fixed epochs use equal expected
sampling mass for reviews and replay, selecting by reviewed masked loss only.
Exact PDFs/images are split-isolated, but exports lack physical-building aliases.
Source-PDF/preview association relies on recorded provenance rather than a
cryptographic renderer receipt. Neither partial loss nor its split policy proves
independent every-room accuracy.

An independent source/completion audit and twenty-two fabricated tests pass,
including rehashed-label/protected-PDF/alternate-preview rejection, complete
run-lineage checks, late byte mutation and checkpoint overwrite protection.
There has been **no actual customer-review adaptation** and no child checkpoint.
The latest live aggregate check found zero saved review events and zero explicitly
complete floors. Taps already preserve approvals and guide review priority;
wall-model adaptation remains an explicit offline operation requiring suitable
reviewed data and subsequent complete-room evaluation.

## Release

Application commit `7ffeb4a` is deployed on `tim-development` using
`.next-room-review-20260930b`, with the follow-up `f88c87a` allowing old confirmed
floors to explicitly attest completeness. That follow-up passed the production
build, TypeScript, lint with zero new errors and all fifteen phone browser checks
against a restored disposable database. The added browser check verifies that
re-attesting a legacy confirmed floor preserves every approved outline. Public
health, anonymous sign-in gating and the live A511 mobile review controls pass
after this release, with zero browser exceptions.
Both additive migrations were applied; the prior
release and static assets are retained. A fresh backup completed successfully.
Live public health and anonymous sign-in gating pass; the existing A511 sheet
opens with the new review controls on a phone-sized browser without exceptions.
The local source, database and browser checks passed before deployment. Model
checkpoints and experiments remain isolated and unapproved.

A511 was rerun through the live reviewed pipeline after release: 128 pending
proposals (107 inserted, 21 existing pending proposals updated; unmatched old
proposals were retained as superseded). The lease completed, the source-byte
fence passed and application/database health remained available. No previously
approved/manual outlines existed on that floor at launch. This is an end-to-end
execution check and a proposal count, not a real-sheet recall measurement.
