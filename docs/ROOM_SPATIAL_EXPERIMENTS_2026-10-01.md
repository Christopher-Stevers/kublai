# Room detection: repetition, navigation and cross-sheet evidence

**There is still no evidence of human-level, every-room accuracy on the actual
floor.** This round implemented and ran different approaches rather than training
another variant of the same segmentation model. Three plausible repeated-room
copies are the strongest qualitative result. The full-floor navigation method,
detail registration and external reference did not meet acceptance criteria.
They remain offline. The production change fixes missing monochrome PDF images.

The existing app already records room approval, rejection, corrected outlines,
missed-room traces and explicit whole-floor completion with source provenance.
See [the live workflow and validation](ROOM_DETECTION_VALIDATION_2026-09-30.md).
Copies produced by these experiments cannot inherit a source room's approval.

## What existing software suggested

These are workflow or algorithm inspirations, not claims to reproduce vendors'
private models or advertised accuracy:

- Kreo documents selecting an area and using **Find Similar Areas**. That suggests
  treating repeated and mirrored apartments as useful evidence within one drawing.
  [Kreo's feature description](https://www.kreo.net/news-2d-takeoff/spring-renewal-with-new-ai-tools-features-and-improvements)
- Robot navigation research partitions free space through narrow passages. That
  offers an independent route to unlabeled halls and common rooms, although
  construction drawings contain furniture, dimensions and symbols absent from
  clean occupancy maps. [ROSE²](https://arxiv.org/abs/2203.03519),
  [Fraunhofer's implementation](https://github.com/ipa320/ipa_coverage_planning)
- Bluebeam's alignment workflow suggests using the **whole drawing set**: enlarged
  suite plans, overall plans and multiple views can constrain one another.
  Registration must respect drawing scale, reflection and revisions.
  [Bluebeam alignment documentation](https://support.bluebeam.com/online-help/revu20/Content/RevuHelp/Menus/Document/Overlay/Overlay-Pages--MT.htm)
- Revit can export room/space boundary information in IFC. When a project actually
  supplies that source, explicit building geometry may be stronger than recovering
  boundaries from a PDF. No IFC source was available or tested in this round.
  [Autodesk's IFC export settings](https://help.autodesk.com/cloudhelp/2024/ENU/Revit-DocumentPresent/files/GUID-E029E3AD-1639-4446-A935-C9796BC34C95.htm)
- The MIT `roomgraph` project pairs wall faces and retains separate room and
  walkability graphs. Its documented limitations include drawing/exporter
  assumptions; its synthetic tests do not prove performance here.
  [Repository](https://github.com/aec-platform/roomgraph),
  [limitations](https://raw.githubusercontent.com/aec-platform/roomgraph/main/docs/LIMITATIONS.md)

## Executed approaches

| Approach | Actual result | Decision |
| --- | --- | --- |
| Streaming interpreted PDF paint | Correct floor: 469,360 paths, 10,829 glyph records, 2 images; 2.73 s child time, 970 MiB sampled peak RSS | Usable offline evidence reader; not a wall classifier or room detector |
| Repeated/mirrored room matching | One development example produced three additional plausible bedroom copies in 0.59 s on structural ink | Promising for reviewed-example assistance; no independently verified accuracy |
| Label-free navigation partition | 20 supported narrow cuts, 416 regions; merged/omitted real areas and many annotation fragments | Reject as the app's detector |
| Drawing-set indexing | 36 pages, 68 candidate detail captions, 274 suite anchors across floor/ceiling views; 268 have a same-type detail candidate | Candidate cross-references only; ambiguity retained |
| Enlarged suite registration | Suite K at 1:50 against four 1:125 floor instances; zero registrations passed fixed checks | Retain all four failures; do not copy geometry |
| Unmodified `roomgraph` | Commit `772f0954a33d7930c5a9c5e3a48335831cc06ba7`; killed at 60.06 s, 683 MiB sampled peak RSS, no result | Failed this interactive runtime budget; room accuracy unmeasured |

Room counts, paint counts and copied candidates are **not** precision/recall.
No complete independently reviewed reference exists for this actual floor.
Protected corpus targets were not reopened or used to choose settings.

### Streaming extraction

The [new adapter](../scripts/rooms/stream-vector/README.md) uses PDFBox 3.0.7
incremental graphics callbacks. It preserves line/curve controls, transformed
coordinates, state/clip references, paint order and glyph/image/annotation
records in compressed, hashed chunks. The previous 200,000-path implementation
was left frozen. [PDFBox's version 3 I/O guidance](https://pdfbox.apache.org/3.0/migration.html)

The reader uses bounded records and a 256 MiB expanded spool limit, while the
parent enforces a 60-second / 2 GiB sampled RSS ceiling. A generated 200,101-path
fixture completed; so did the actual floor and suite detail. The correct floor
took 2.726 s, sampled peak RSS 1,017,487,360 bytes. These are child-process
measurements, not total UI latency or an instantaneous kernel memory guarantee.

The output is interpreted paint evidence, not raw lexical PDF numbers, CAD entity
identity or certified visibility. Unknown/complex clipping, native images and
physical wall semantics remain separate concerns. The experimental heavy-black-
stroke raster lost thin/light walls and retained some annotation loops, which
explains why successful extraction did not imply successful partitioning.

### Repeated rooms

The [matching prototype](../scripts/rooms/spatial-hypotheses/repeat.py) checks
rotations/reflections, boundary agreement, ink precision/recall and contradictory
new interior strokes. It preserves holes in an example mask. Every match remains
pending, including when the source example has human approval.

The actual example was a development rectangle selected on the already exposed
source drawing, **not a human-approved outline or an independent reference**.
After correct image/vector pairing, the three additional matches correspond
visually to the other top-wing bedrooms, including mirrored layouts. This is
useful qualitative evidence, not a valid whole-floor recall score. The returned
outlines inherit the example's approximation and need real boundary review.

The important next product experiment is to propagate a genuinely reviewed
outline, expose the supporting overlay, and make each copy easy to accept,
correct or reject. Never use room copies as training truth before that review.

### Free-space topology and cross-sheet registration

The navigation prototype finds medial-axis bottlenecks with continuous wall-face
witnesses on both sides. An independent toy floor yields four rooms plus its
unlabeled hallway, with no room-name seeds. A bent, constant-width hall stays
together and an exterior leak stays unresolved. On the actual mixed drawing,
the structural-ink input is inadequate; more door closures would not repair
missing thin walls or annotation contamination.

The drawing-set index discovers suite/detail candidates without interpreting
them as boundaries. H and H-BF remain different, and multiple candidates remain
ambiguous. A known limitation is a wrapped `VARIATION` caption: one bedroom view
can still appear among full-suite candidates. The 268 links are not verified
view matches, and suite indexing does not solve unlabeled common spaces.

The separate registration prototype fits a similarity/reflection with SIFT and
RANSAC, then checks withheld matches, printed scale, spatial coverage and ink
agreement. The Suite K crop was selected before registration; all four indexed
instances were tried with the same settings. Results failed correspondence or
transform-support requirements. Thresholds were not relaxed after seeing them.
Likely next alternatives are structural wall-junction graph matching and partial
alignment that tolerates dimension/fixture differences. Those alternatives are
proposals, not completed implementations or explanations proven by this trial.

## Source-page correction

The app calls this floor **A511**, but the imported image is `floor-18.webp`:
original **PDF page 18, zero-based index 17**, sheet **A204 / level 1**. Its
database `pageNumber = 19` is an import slot, not the original PDF page.
Production already extracts the correct page from the image URL.

The earlier vector-topology/compat failures and the first streaming/spatial trial
used PDF page 19 / index 18 / sheet A205. Their extraction failures/counts remain
valid for that page, but their attribution to the A511 image was wrong. The first
mixed image/vector spatial comparisons are disqualified. All original plans,
source snapshots, logs and failures were retained. Image-only comparisons that
used the same page-18 PNG remain internally consistent qualitative studies.

A fresh page-18 render exactly matched the cached image SHA-256. The corrected
vector extraction and separate spatial study bind PDF bytes, original page,
PNG bytes and isotropic viewport explicitly. Six regression tests reject
adjacent pages even with identical aspect ratios, wrong database slots, changed
PDF/PNG bytes and inconsistent coordinate conventions.

## Production PDF decoder fix

Both the detection rasterizer and isolated upload renderer omitted PDF.js's
`wasmUrl`. PDF.js 6.2.108 consequently warned that it could not decode JBIG2
images, then returned a page with those images missing. The shared server options
now resolve decoder assets from the installed package and use Node filesystem
loading. A production build also caught and fixed Webpack rewriting a static
`createRequire(import.meta.url).resolve(...)` into a numeric module ID.
[PDF.js initialization options](https://mozilla.github.io/pdf.js/api/draft/api.js.html)

A self-authored JBIG2 room fixture rendered completely white before the fix.
Two integration checks now verify every expected wall pixel and the upload
preview's walls/open doorway. The fixture has no customer data and needs no
external download. The actual detail page 25 now renders without decoder
warnings. It changes 3,827 pixels in an embedded-image area, **not the Suite K
crop**, which remains byte-identical. This fix does not explain or erase the
failed registration results, nor does it establish general room accuracy.

Existing partial renders and their receipts remain intact. The shared options
configure available decoders; this is not a promise that PDF.js rejects every
malformed image. Its `stopAtErrors` option alone does not make its asynchronous
image-decoding failure path fail closed, so no such guarantee is claimed here.

## Validation and original evidence

- 38 independent new Python checks passed: 9 streaming, 12 repetition/navigation,
  6 page binding, 5 drawing indexing, 6 registration. No downloaded room targets.
- Both new real-render integration tests passed. The existing invalid-PDF,
  over-100-page and huge-canvas test also passed.
- Existing application suite: 258 tests across 50 files passed.
- TypeScript passed; changed server/render test files pass ESLint.
- A raw-byte audit checked 260 source/archive/chunk/artifact hashes across all
  eight original experiments. They match their retained records; this is an
  integrity check, not another detector run or an independent accuracy review.

The production fix is commit `ef47f5a`, built from the deployment checkout and
released as `.next-room-decoder-20261001` (build ID
`ZP2mbdhtAxMFeZVpc0ilp`). Local and public health endpoints report a healthy
database after restart at 2026-10-01 03:35 UTC. The previous release is retained;
five sampled previous-build JavaScript assets still serve byte-for-byte. Both
renderer regression tests also pass from the deployment checkout. No
experimental detector was enabled, and no database/review data was changed.

Actual drawings, reference checkout, runtimes, generated masks, overlays and
logs remain private under
`/home/tim/datasets/foremanhq-room-detection/stream-vector/`. No proprietary PDF,
corpus data, API key, Java runtime or copied external implementation enters Git.
The Apache runtime and external MIT reference were run locally; no drawing was
uploaded to a new provider.

| Original private record | SHA-256 |
| --- | --- |
| Source PDF | `17b15aed60b6b251bfe704a0c2752bab85e196ad3dcfdd2917659bd988991b4f` |
| Page-18 cached/fresh PNG | `0047f9a9c46b0a5e8770be18a7fbaefd1dd80496d3c24fa09cd233ea0a591828` |
| Correct source-page receipt | `3f66cff8a60ded1746c0b1fe49844e94ed1be5cd227335a43b715150629d6506` |
| Correct page-18 stream plan | `5bc1e41a151064183d3972b99ca3c593eb1eed7b8a13abeac612bfd9633235ab` |
| Correct page-18 stream summary | `f2057fea73b61dc6f09200aae4d3260eb25574226b1686ae01c75ec87f798244` |
| Corrected spatial plan | `594bd31f6410f41e39e471428c842cadf1d1ad1ae9e707e5d8fe208b2afcb8ae` |
| Repeated-room candidate metadata | `c5b810f3ba96aca422b85e8772e417a548fd53ddc5ea86ea97467105c55f1fb7` |
| Drawing-set index | `dae62971a8ec12158462cd24401f2126284f27fbab9f4dd69ecc6fd1c2821f05` |
| External reference plan | `1f51a749cd6f5d3ed0c3e52ec55b1cd235431721a42d8d8e4088b6cde7ed818d` |
| Detail page with decoder fix | `d4c7320107d446735a004058a9c3fc67eaf59e56457afb2d9d42a00d152aede8` |
| Raw-byte audit | `f4998fc6f6fb23859ddc70715a8b4df3715c12d75722cfe858be3d426ab9b6e0` |
| Final decoder verification and source pins | `352d6df3a45e230b61301d45afb7d50f537da684580fda083e42ae4fdadaf077` |

Old sources are frozen within each trial archive. Failed experiments are spent
and retained; a new declared study is necessary for a changed method. Accuracy
promotion still requires independent, explicitly complete real-floor review,
including halls/common areas, then misses, extras, merges/splits and whole-floor
completeness measurements across jobs. Synthetic success alone cannot clear it.
