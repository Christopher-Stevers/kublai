# Fixed directional Suite K registration declaration

This offline study tests geometry registration on one already exposed drawing
pair. It has no room detector, room-copy path, training data or production toggle.
Execution outcomes belong in a separate dated result report; this declaration is
held byte-for-byte after its original attempt.

The printed scale fixes .4 exactly: native page-25 crop `[1240,150,2135,1290]`
(895×1140) becomes 358×456, using PIL's pixel-center affine `.4*x-.3`.
Nondivisible helper input dimensions fail rather than exporting an inexact scale.
The same four page-18 Suite K indexed anchors and original ROIs are pinned in
`directional_trial.py`. No target/crop is chosen from room reference geometry.

Unlike the previous SIFT attempt, this method needs no texture-keypoint
correspondence to begin searching. Eight fixed right-angle/reflection states are
tested with translation only. Achromatic ink ≤224 luminance supplies axis runs
at least18 native floor pixels long. Whole adjacent-row run families are grouped
first; bands wider than12 pixels are wholly excluded, preventing thick-stroke
chunks from entering both fit/check. Alternate complete source groups propose
and check the placement. These are disjoint observable run groups, **not
independent physical-wall labels or independent statistical samples**.

Directional distance transforms plus FFT correlation compute all translation
costs in each fixed ROI. The orientation-distance approach is inspired by
[Liu et al., CVPR2010](https://www.merl.com/publications/TR2010-045);
this compact axis implementation is our own, not their exact fast algorithm or
an established floorplan solution.

Fixed checks in `SETTINGS` require both axes, held-out residual/support and
spatial span/quadrants, the indexed label center inside the transformed crop
frame, reverse target support, no sufficiently long unexplained target run,
one supported transform and a runner-up fit margin. Frame containment does not
prove a label belongs to a physical room. More than32 distinct eligible peaks
per orientation makes the instance unresolved; none are silently selected as a
solution. Every cost surface, eligible retained peak and each orientation's
best failed placement remains available for falsification. Full surfaces retain
over-budget or higher-cost peaks that are not exhaustively described in JSON.
The peak list itself is bounded, not an assertion that no other local minima exist.

Fabricated examples exercise real translation/reflection, regular wrong grids,
forward-matching dense clutter, fit-only evidence, symmetric ambiguity, bad
anchors, overwide bands and byte drift. Gates are set before actual input
inspection and are not loosened afterward. The parent enforces120 seconds for
the entire fixed attempt, including preparation/child/byte verification; output
data is limited to256MiB. No PDF is decoded: pinned existing RGB renders are used.
Native source PDF bytes, original pages18/25, raster receipts, old target metadata,
source archives and initial emission digests are recorded and rechecked.
Runtime package versions are recorded; all transitive binaries are not vendored.

The old page-25 full render omitted an embedded image outside this exact
vector-only crop; the subsequent decoder fix left this crop unchanged. Preserve
the original render and failure history rather than replacing it.

Dense dimension grids, stair treads, furniture, revised detail geometry,
unmodeled oblique walls and faint/colored structural ink can defeat these
checks. A successful transform is unreviewed evidence and cannot transfer an
approval or make an enlarged plan a certified room reference. Actual room
accuracy remains unmeasured. No protected/new-once corpus or independent real
room truth enters the study.

```sh
/home/tim/datasets/foremanhq-room-detection/raster2seq/.venv/bin/python -m unittest discover -s scripts/rooms/multiview -p 'test_directional*.py'
# Only after source preflight: spends the fixed original declaration once.
/home/tim/datasets/foremanhq-room-detection/raster2seq/.venv/bin/python scripts/rooms/multiview/directional_trial.py
```
