# Drawing-set legend identification

The Piping system tool automatically compares a selected line/system with the
**reviewed, saved Legend Items for its drawing set**. Results remain candidates;
confirming a count is a separate user action.

## Generalization rules

- Never encode project IDs, sheet numbers, sample drawing coordinates, supplier
  catalogues, or fixed tag-to-component mappings in recognition code.
- The saved legend supplies names, abbreviations, symbol crops and provenance.
  The same mechanism accepts custom names and abbreviations on other drawings.
- Compare normalized vector geometry across page proportions, uniform scales
  and arbitrary orientations (principal-axis normalization with symmetric-axis fallback). Keep disconnected strokes belonging to the
  same symbol together; separate widely spaced symbol variants in a legend cell.
- Use the selected pipe's spatial context and system ownership. A nearby exact
  legend abbreviation can distinguish otherwise identical symbols. Prefixes
  must not match (for example, `ABC` does not match `ABC2`).
- Never let reference ordering resolve conflicting meanings. Ambiguous symbols
  remain ambiguous. Tag-only matches explicitly state that geometry was not
  verified.
- The piping classifier has general type vocabulary (valves, elbows, tees,
  reducers, couplings and caps), not drawing-specific symbol definitions.
  Unclassified/cross-discipline symbols require their own nearby legend label
  as additional evidence rather than being named from a common shape alone.
- Source layers receive bounded, fair extraction budgets regardless of their
  names or PDF painting order. Missing geometry and exhausted budgets are
  reported as partial analysis, never as a complete takeoff.

## Data and execution

Each reference carries its reviewed legend ID/revision and source sheet name.
Source access is rechecked per request and restricted to the selected drawing
set and organization. Older immutable PDF geometry caches can be rebuilt by a
bounded server worker. Matching runs in the existing browser geometry worker;
selection/revision changes discard stale asynchronous results.

Scanned/raster symbols, heavily distorted symbols and incomplete source geometry may need manual identification. Sizes,
materials and quantities must not be inferred merely from a symbol's appearance.

Regression coverage includes synthetic legends with arbitrary names/labels,
cross-page coordinates and aspect ratios, rotation/scale, ambiguous shapes,
nonmatching label prefixes, foreign systems, late PDF layers and asynchronous
source changes. Real drawings are validation examples, not implementation rules.

## On-drawing component symbols

Identified components now show vector symbol overlays in a color chosen to contrast
with the selected pipe. Shape matches preserve the detected symbol geometry and
orientation, with the saved legend identity attached. Label-only discoveries are
listed as unresolved. They do not place symbol overlays and cannot be confirmed as
counts until a physical position is established; users can locate the label and
place a count manually after checking the drawing.
The preview has a dotted review outline. Confirming a count stores its compact vector
snapshot with the existing count metadata, so the same symbol survives reloads,
legend edits, and drawing exports without downloading another image. Dismissed
candidates disappear from the current preview. These previews do not create counts.

Elbows, tees, and vertical transitions use custom vector marks. Endpoint topology
recognizes 90°, 45°, and 22.5° turns within the existing four-degree tolerance; marks
follow the detected pipe rays. Up/down marks require a matching reviewed symbol or
explicit pipe-up/pipe-down description. An endpoint alone never establishes a rise
or drop. Unknown shapes use a neutral question-mark symbol, not an invented valve.

Public reference research (October 19, 2026):
[pipe up/down image collection](references/pipe-up-down/index.html) contains five
visually verified crops from two published mechanical legends, with source URLs,
page numbers, PDF hashes, and crop coordinates in its manifest. Turned elbows are
shown at line ends; vertical tee outlets also occur along continuing runs. Preserve
open/closed geometry, connection orientation, and internal details. A symbol can
mean "drop or rise" without establishing direction, and UP/DN can describe pitch.
Use each project's reviewed legend as the authority. These reference images are
research material, not automatically imported detector templates or verified
in-plan occurrences.

Snapshots are limited to 100 paths and 2,000 points. Rendering shares the existing
SVG camera and memoized annotations; panning does not redo recognition or fetch
symbol images. Validation includes angle/orientation fixtures, schema round trips,
bounded geometry, review-versus-confirmed rendering, the viewer confirmation flow,
and phone/tablet/desktop browser checks. Actual M-103 DHWR analysis was also checked
with M-001 legend references; that is desktop evidence, not iPad performance proof.

## Inline locations and adjacent valves

Recognition searches shape geometry along the selected pipe first. Nearby labels
name the nearest compatible symbol rather than supplying its coordinates. A label
at an equal distance from competing symbols does not decide either identity.
Compact valve paths are kept separate from long connecting pipe strokes, and
candidate deduplication scales with symbol size rather than a fixed page distance.

When symbol extraction is partial, closed paths omitted by that smaller cache can
be recovered from the existing bounded measurement geometry near the selected
pipe. Recovery rejects disconnected/clipped paths, retains the existing 15,000
path / 200,000 point budget, and does not change pipe measurements or require a
fresh PDF download. It still reports partial analysis when source data is partial.

The M-102 regression area with DW-45 / DW-46 / DW-43A was checked against a rendered
source-PDF crop: all three CBVs align with their actual valve depictions, including
the previously missed lower valve. Additional synthetic tests cover arbitrary
rotation, neighboring different labels, very small adjacent symbols, connecting
pipe strokes, cache recovery and unresolved-label confirmation blocking. No sample
coordinates, page numbers or tag names were added to runtime matching rules.


## Independent junction pass (October 19, 2026)

Symbol recognition and pipe topology use separate query budgets. Located symbol
paths are excluded from topology; their bounding boxes and nearby text never mask
real branch locations. Reviewed tee/elbow geometry remains available as pipe
linework. This changes recognition only, not the selected pipe or its measured length.

Endpoint checks allow small drafting gaps bounded by stroke width and a maximum
0.00015 sheet-width tolerance. A further local pass checks for repeated dashed
runs (including PDFs that store each dash as a separate solid stroke): it requires
matching ink style, collinear strokes on both sides of the branch, and at least
two comparable gaps. It does not bridge an isolated break or infer a connection
to a more distant parallel line. Unsupported cases remain unresolved.

Results merge by component kind and physical junction. Two topology observations
within stroke tolerance must share at least two source paths before they collapse;
a three-arm junction replaces a two-arm observation of that same junction. Marker
boxes do not determine whether two neighboring fittings are duplicates. All
proposed tees still require review; this does not establish part sizes or SKUs.

Validation: regression cases cover a valve beside a tee, overlapping valve/tee
bounds, a callout over two nearby tees, rotated dashed branches, isolated breaks,
neighboring pipes, and unchanged measurement geometry. Actual M-102 DHWR source
was checked at the DW-48 / DW-47C branches from Tim's screenshot: both previously
missing junctions appear, the 58 valve candidates remain, and selected linework
and length are unchanged. Analysis took about 0.5 seconds on the desktop fixture;
that is not a phone performance benchmark or proof of every sheet's accuracy.

## Vertical and terminal fittings (October 19, 2026)

A separate bounded geometry pass matches reviewed legend symbols for turned
elbows, vertical tee outlets, top/bottom connections, caps/plugs and ambiguous
rise/drop symbols. It interprets the legend's description, not a job name, sheet
number or hardcoded layer. Public reference crops remain research material;
the project's reviewed vector legend supplies the actual matching shapes.

The pass removes arbitrary-length straight pipe stems before comparing compact
symbol shapes. It preserves open/closed outlines, supports rotated/scaled shapes
and paired arcs or overlapping loops, and checks local pipe connections. One
connected arm indicates a terminal elbow; opposed continuing arms indicate a
vertical tee when the legend permits that meaning. A bare endpoint is not a cap.
Pitch, flow, duct and tag descriptions are not vertical fitting evidence.
Conflicting meanings and legends that explicitly say "drop or rise" remain
unresolved review candidates. Missing or clipped geometry can still prevent
recognition; no direction is inferred solely from an endpoint or a nearby UP/DN.

Partial-cache recovery now includes compact open strokes without closing them.
The vertical fitting glyph is excluded from the independent planar-junction
pass, while its connecting pipes remain available. Custom markers distinguish
90° UP/DN and T UP/DN, preserving explicit angles in legend names. Caps retain
the matched source glyph. Confirming quantities remains a separate user action.

Validation covers open versus closed outlines, paired tee symbols, caps, rotation
on non-square pages, stem-length differences, explicit angles, conflicting
legends, unconnected circles, and glyph/junction separation. Actual M-102 DHWR
analysis preserves the prior valve fingerprints, selected pipe geometry and the
two verified dashed tees. A rendered PDF crop was checked in Chromium for marker
placement and rendering errors. This is not a claim that every fitting on M-102
has been found, nor a phone performance measurement.

## Closed-circle extraction coverage (October 19, 2026)

The v3 symbol cache shares unused capacity across source layers within the same
15,000-path / 200,000-point limits. Earlier fixed per-layer allowances discarded
late circles even when most of the total budget was unused. Under pressure,
recoverable linework is evicted before closed curves: closed curves deliberately
never enter the length-bearing measurement cache. Layer names do not determine
priority or meaning. Oversized and incomplete extraction still reports limits.

Partial v1/v2 caches are reparsed; complete older caches remain usable. Browser
geometry requests revalidate so refreshed server caches do not stay hidden behind
an immutable response. M-102 source-PDF verification locates the three previously
missed circular endpoints near DW-48 / DW-49 as 90° up. Existing valve fingerprints
and selected pipe measurements remain unchanged. Additional budget-pressure tests
cover sparse layers, late curves and the hard global bounds.
