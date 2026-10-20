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
  and quarter-turn orientations. Keep disconnected strokes belonging to the
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

Scanned/raster symbols, arbitrary non-quarter-turn rotations, heavily distorted
symbols and incomplete source geometry may need manual identification. Sizes,
materials and quantities must not be inferred merely from a symbol's appearance.

Regression coverage includes synthetic legends with arbitrary names/labels,
cross-page coordinates and aspect ratios, rotation/scale, ambiguous shapes,
nonmatching label prefixes, foreign systems, late PDF layers and asynchronous
source changes. Real drawings are validation examples, not implementation rules.
