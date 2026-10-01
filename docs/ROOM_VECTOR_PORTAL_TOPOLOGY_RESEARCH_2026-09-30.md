# Vector-native portal topology: bounded prototype proposal

Status: **research and source inspection only; unimplemented and untested**. No project drawing PDF, native drawing pixels, corpus targets, model weights or GPU were opened for this task. No dependency installation, inference, training, provider call, production edit or benchmark replay occurred. The running domain-model experiment and existing frozen sources are separate. The previously reported raw-graph 1,812 faces / 1,596 spaces are diagnostic counts supplied by the parent, not room-accuracy evidence or a run repeated here.

## Recommendation

Build one separate, CPU-only **painted-path → physical wall bands → jointly witnessed door portals → planar free-space topology** prototype before another vector room-count experiment. Its first deliverable should be independently inspectable portal evidence and unresolved wall/envelope breaks, not a claimed complete-room detector. Native vectors retain thin gray walls and door geometry without the learned model's spatial compression, but geometry alone cannot resolve every construction-sheet symbol or distinguish an unlabeled courtyard from a similarly drawn enclosed room.

Keep door closures in the partition geometry and keep door passability in a separate adjacency graph. A door connects two spaces; it should not merge their room instances. Emit supported unlabeled spaces, including large or narrow circulation spaces, rather than requiring room labels or inheriting unit-growth behavior.

## What the current APIs lose or assume

| Inspected source | Concrete limitation relevant to the prototype |
| --- | --- |
| `src/server/rooms/pdf-walls.ts:5, 351–709` | `WallSegment` has endpoints, width, dash/order/curve/fill/layer but no RGB, alpha, path/subpath identity, Bézier controls or clipping provenance. `curveTo`/quadratic paths become endpoint chords. Recovered polyline curves also become chords. Stroke width remains the graphics-state value while points receive the CTM. |
| `pdf-walls.ts:376, 447, 640–727` | Coordinates are clamped to independently normalized x/y axes. Paint-time fill recovery is bounded to selected small outlines, not an exact physical fill region. General clip paths, form bounding-box clipping and hidden optional-content visibility are not applied by this extractor. Length/page-edge filters and the plain-line budget can remove thin/short jamb evidence. `supplementarySegments` is less budgeted but remains filtered, excludes true curve records, and lacks path/control provenance; flattened line-sampled curves may survive as ordinary segments. |
| `src/server/rooms/wall-lines.ts:252–525, 765–921` | Pairing is useful existing groundwork, but it collapses intervals into centerlines and a dominant thickness. `doorArcAcrossGap` measures the chord and looks for an endpoint close to the wall as a hinge; a real circular swing's hinge is its **center**, not either curve endpoint. A quarter-circle chord is √2 times its radius/leaf length. Short gaps and some corner gaps can become doors without a leaf + two-jamb proof. |
| `src/server/rooms/floor-graph.ts:125–141, 406–422, 647–740, 846–875, 1363–1445` | Global distances/angles use normalized page coordinates; page dimensions are not used by this global graph to restore isotropy. Long/narrow faces are not growable, oversized faces seed outside classification, and unlabeled circulation can intentionally remain unclaimed. Shared weak spans between generic wall endpoints can be classified as doors, and weak-evidence fallback promotes all lines to walls. These are legacy assignment policies, not a contract for every physical space. |
| `src/server/rooms/polygonize-walls.ts:98–135, 199–222, 303–388` | Existing JSTS noding/polygonization is reusable conceptually, but snapped faces do not prove wall semantics. Ring area/width/vertex filters remain even with `keepLarge`. Later union/subtraction helpers serialize outer rings only, discard holes and select a single component. Do not use them unchanged for physical free-space exports. The prototype needs source-associated dangle/cut-edge/invalid-ring diagnostics and retained holes/components. |

The earlier raster `scripts/rooms/models/hybrid_native.py` already requires connected leaf/swing evidence and supports double swings, but is directional raster evidence and was rejected in development. The new hypothesis adds retained curve geometry, jambs, continuous physical wall bands, page-metric correctness and path-level attribution; it is not a relabeling of that result.

PDF.js `getOperatorList` is a usable extraction entry point, with explicit annotation inclusion options. Its normalized paint operators are **not original CAD entity identifiers**. Generate deterministic IDs from the frozen PDF hash, page, normalized paint index, form-instance stack and subpath index, and call them extraction IDs. Pin the installed PDF.js version and test its actual `constructPath` representation; import exported `OPS` rather than copying numeric constants. [PDF.js API source](https://mozilla.github.io/pdf.js/api/draft/api.js.html)

## Proposed standalone contract

1. **Preserve before classifying.** A new `scripts/rooms/vector-topology/` adapter would export immutable `PaintedPath` records: extraction ID, source operator spans, full line/cubic/quadratic/close commands, raw and transformed coordinates, CTM, form-instance stack, paint/fill rule, RGB plus unresolved color/pattern state, alpha/blend state, dash/cap/join/width, optional-content state, clip chain and page boxes/rotation/UserUnit. Retain ignored paths with reason codes. Do not silently convert an unsupported clip, pattern, transparency group or opaque overpaint into certified visible evidence. PDF painting is graphics-state and clipping dependent, as specified in the [Adobe-hosted ISO 32000-1 standard, §§8.3–8.5](https://opensource.adobe.com/dc-acrobat-sdk-docs/standards/pdfstandards/pdf/PDF32000_2008.pdf).

2. **Use one isotropic page frame.** Apply form/page transforms once; convert to an isotropic page-point frame including UserUnit and rotation. Retain invertible mappings to source and UI-normalized coordinates. Sheet points are not building meters: a calibrated drawing ratio would need its own evidence. Never guess physical dimensions from a presumed door width. Under nonuniform/sheared transforms, retain full transformed curves and footprint geometry; the first portal recognizer can declare those noncircular symbols unsupported.

3. **Recover physical wall hypotheses.** Pair parallel, overlapping wall faces locally and split at provenance-preserving overlap endpoints; preserve multiple wall thicknesses, returns, T/L joints, and curves. Require consistent band continuation/jamb attachments, not just a popular gap or heavy stroke. Keep physical band polygons distinct from their topology centerlines. Filled poché requires proper closed-path/fill-rule handling. Isolated single-line walls remain uncertain unless separately witnessed. Never promote all annotation lines when evidence is weak. The wall-adjacency approach supports the pairing/splitting idea, but its published assumptions include substantially isolated wall layers and opening blocks; it does not solve mixed flattened sheets. [Domínguez et al., 2012, §§3–5](https://ruja.ujaen.es/bitstreams/d87a74a3-9ac9-4d15-af4b-22e849c398d0/download)

4. **Certify only a joint portal witness.** Fit a circular swing from retained controls/adaptive samples, recording residual, angular coverage, fitted center and tangents. Find a leaf segment with one end at that center and its other end at a swing endpoint. The other swing endpoint must agree with the closed-door latch location. Require two jamb/return witnesses attached to continuing wall bands on both sides, a jointly aligned wall gap, and compatible leaf radius/gap width. Remove symbol strokes only from the topology copy; retain their IDs. Insert the closed-position portal band/edge at the wall gap, never the arc chord. A double door requires two distinct hinge/leaf/arc witnesses whose spans cover the same opening; one half-sized leaf beside an open hall is insufficient. Nearby furniture or cloud arcs cannot satisfy the wall-chain requirement. Record geometric residuals and all supporting IDs, not a learned confidence number. This joint geometric approach is consistent with published CAD door/jamb recognition and planar subdivisions; those authors also acknowledge manual corrections and drawing-specific heuristics. [Hobby & Dashti, 2018, §2](https://onlinelibrary.wiley.com/doi/10.1155/2018/5303616)

5. **Keep scope deliberately narrow.** First support intact approximately quarter-circle single/double swinging doors. Freeze one geometry preset on fabricated cases before any real input. Suggested initial relative gates, explicitly unvalidated: circular-fit residual ≤2% of radius, joint endpoint/hinge mismatch ≤3% of radius, sweep 70–110°, ≤5° wall-chain alignment mismatch. Numeric floors must come from source-coordinate precision, not UI pixels. Missing/partial arcs, sliding/folding doors, cased openings, glazing and ambiguous misaligned jambs return `unresolved`; they do not justify arbitrary automatic closures. Geometry tolerances are proposed experiment settings, not facts learned from A511.

6. **Separate envelope, free floor and navigation.** Node only accepted wall/portal topology; emit valid free-space polygons after subtracting physical bands, with exact holes and a tagged dual adjacency graph. Use the actual unbounded arrangement face, not maximum area/aspect ratio, as the external topological region. Maintain multiple supported building components. Do not use a convex hull or bounding box as an interior envelope. A broken exterior wall makes the affected envelope unresolved rather than discarding an entire wing or inventing a long closure. Enclosed pockets require additional evidence or review to distinguish rooms, courtyards, shafts and atria; pure planar nesting cannot certify those semantics. Do not classify a large corridor as outside or erase it because it is narrow. [CGAL arrangement concepts](https://doc.cgal.org/latest/Arrangement_on_surface_2/index.html) describe the face/hole representation; no CGAL dependency is proposed. Existing JSTS can expose noding failures and dangles/cut edges. [JTS Polygonizer documentation](https://locationtech.github.io/jts/javadoc/org/locationtech/jts/operation/polygonize/Polygonizer.html)

7. **Reject fixtures conservatively.** Repeated closed furniture/parking outlines, stair treads, text outlines, hatch and RGB/gray clouds should be attributed as nuisance hypotheses when they lack the structural wall-chain evidence. Color is an observation, not a universal exclusion rule: real colored walls are possible. Small area, thinness, enclosure or a shower-like symbol alone cannot prove background. If a loop could be a closet or physical enclosure, retain uncertainty for review. Labels may later name a space; unit/occupancy descriptions cannot create partitions or certify room completeness.

## Fabricated regression and release gates

Before any actual PDF is opened, independently author at least these groups of fixtures (expected geometry is fixture truth, not source-generated Swiss room GT):

- Rectangular/non-square pages; 90° page rotations; translated/scaled/nested form instances; UserUnit; shear/nonuniform CTM declared unsupported; equivalent encodings produce equivalent geometry.
- Full cubic quarter swings and flattened sampled equivalents; CW/CCW and rotated doors; circle center distinct from both endpoints; isolated chord cannot certify; rectangle corners cannot fit an accepted arc; disconnected dotted samples and repeated cloud lobes fail.
- Single/double doors with valid leaf/hinge/two jambs; missing leaf, either jamb or continuing wall chain fail; a half door beside a wide corridor fails; no false corner/cased-opening closure; conflicting witnesses are unresolved.
- Thin gray and paired/filled walls; mixed thicknesses and shared wall faces; duplicates/reversed paths; correctly restored dash/RGB/alpha/clip states; invisible/clipped/overpainted paths cannot supply certified witnesses.
- Long winding unlabeled corridors, wide lobbies, multi-wing plans and courtyards; preserve wall/column holes; an exterior leak is explicitly unresolved; a window band is a barrier, not a navigable door; stair treads/furniture/parking/title frames do not become rooms.
- Provenance mutation/copy guards, deterministic IDs under the pinned normalized operator stream, valid disjoint polygons, area/holes agreement, bounded resource failures and all attempted-case coverage.

Freeze own sources/runtime/settings and private input/output hashes with per-witness receipts, reason counts and original-path completion before future review. Suggested prototype resource ceiling: 200,000 path commands, 10,000 local portal candidates, 60 CPU seconds and 2 GiB per page; exceeding it fails explicitly. These are ceilings to test, not measured runtime. Use spatial indexing to bound wall-pair/portal searches rather than all-pairs processing.

First inspect portal precision and unresolved coverage independently. Only a later authorized real-sheet study with manually verified wall/door/envelope evidence and independently complete physical-room polygons can measure misses, extras, merges/splits and zero-miss-floor success. The prototype must not consume reference-derived seeds, counts, crop boxes, model outputs or a presumed building envelope. Review choices should distinguish missed wall, false portal, missing portal, courtyard/shaft ambiguity and wrong room partition; rejected room proposals are not background truth.

## Alternatives and practical cost

`aec-platform/roomgraph` is a newly found MIT-licensed reference with a similar wall-pair/symbol pipeline. Its own limitations explicitly include paired-wall dependence, clipping not applied, curved/filled-wall restrictions, accidental gaps as openings, and self-generated exporter fixtures. It is useful for comparison of contracts; it is **not verified on our sheets**, was not installed/run, and is not a replacement recommendation. [Repository](https://github.com/aec-platform/roomgraph), [limitations](https://raw.githubusercontent.com/aec-platform/roomgraph/main/docs/LIMITATIONS.md), [license](https://raw.githubusercontent.com/aec-platform/roomgraph/main/LICENSE)

The highest-value next bounded implementation is therefore the preserved-path parser plus certified portal receipts and fabricated tests, followed by audited wall-band/envelope topology. It costs engineering and CPU tests rather than another training run or service. Doorless openings, courtyard semantics, missing exporter information and mixed symbols remain real research/review problems; passing fabricated tests cannot establish complete actual-room detection.

## Inspected source identity

Inspection HEAD: `4465552730735d44d001fae992095d38c73341fc` (other agents may advance it). SHA-256s of unchanged inspected sources:

```text
pdf-walls.ts         ce2b94bcee0d53d2f70c6473d67650025a5fc18cfa7280842c55d7adefe5efb4
wall-lines.ts        bb2b73a55210afb9be9b70276dac3041f3334262d655cef87707343924b18347
floor-graph.ts       479e8602c129b4338e2ac2f9c691b7e7e343ca08e0dbaefd852fbd543a6af53d
polygonize-walls.ts  d2de34617937272a139f385c08857b2c8d3386701ab3f46721e57380252b5834
hybrid_native.py     123e74fbfababf8fe8d55a87d5fa816fddb8ad7c83110e3a09b0d2347e494b24
```

Installed source/API inspected: `pdfjs-dist` 6.2.108 and `jsts` 2.12.1 from the repository lockfile. No existing parser, graph, model, partition, dataset or frozen research source was edited.

## Subsequent executed prototype, 2026-10-01

The implementation status above records the research inspection. A new,
separately frozen painted-path parser, joint portal kernel and optional glyph
compatibility profile now exist, with 83 fabricated checks and two full-CLI
smoke fixtures. Both fixed A511 attempts failed before emitting geometry;
building-envelope/free-space partitioning remains unimplemented in this
prototype. [The execution report](ROOM_VECTOR_PORTAL_PROTOTYPE_2026-10-01.md)
records both original spent failures, unchanged limits/source bytes and the
independent raw-byte audits. This is not an actual-room accuracy result or a
production release.
