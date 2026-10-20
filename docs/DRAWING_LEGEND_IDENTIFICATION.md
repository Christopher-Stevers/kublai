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
