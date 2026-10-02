# Saved wall-mask topology probe

**The structural model is a useful research signal, but this simple partition
does not detect every physical room. It is rejected for production.** Codex
inspected all five actual source overlays after this single fixed pass. No
reviewed answer key was available; counts below are not correct-room counts.

`partition_saved.py` reads the already completed, pinned five-view outputs from
the official CubiCasa probe. It runs no model, training, database writes or
protected-corpus evaluation. The model's noncommercial restriction also remains
separate from this qualitative performance decision.

The declared operation unions wall/window/door argmax masks, closes with one
3x3 square at model resolution, and finds four-connected free regions. Every
edge-connected region is retained as unresolved: it can contain genuine rooms
that leaked through a missed wall. Components below 25 model pixels are counted
separately. Pixel-center contours preserve holes and are quarantined when
invalid; there is no buffer repair, smoothing, largest-component selection or
conversion to a rectangle. Added barrier pixels are explicitly recorded as
inferred geometry, not actual source walls.

| View | Unreviewed valid outlines | Edge-unresolved regions | Other |
| --- | ---: | ---: | --- |
| Full sheet | 7 | 7 | 1 below pixel floor |
| West upper | 13 | 4 | 2 below pixel floor |
| West lower | 8 | 4 | - |
| North common | 8 | 1 | 1 invalid ring |
| East upper | 10 | 4 | - |

Views overlap; these numbers must not be summed into a floor count. The full
sheet loses almost all small-space detail at 1024 pixels. Regional crops recover
some bathrooms, bedrooms and stairs. Missing wall/door connections still merge
multiple spaces; some tiny fixture-shaped enclosures remain. The north-common
outline merges several rooms and a circulation area. A visually plausible wall
overlay therefore does not establish correct room topology. One-pixel gaps can
change connectivity drastically; blindly increasing closing would invent more
walls and does not constitute a fix.

The immediate architectural implication is to assess boundary continuity and
doorway separators explicitly, retain alternative split/merge hypotheses and
use source-supported wall geometry. A mask argmax plus flood fill is inadequate.
Learned structural evidence should complement, rather than replace, source
geometry and review. Neither model agreement nor a valid polygon proves a room.

The exclusive private output is:
`/home/tim/datasets/foremanhq-room-detection/wall-probe/cubicasa-official/partition-raw5-20261002`.
Its report SHA256 is
`029b0edb6564336c0827ecc187745f7c5338403ab45f1b90e9dc200c0a971cba`.
The input model report SHA256 is
`ccc0844b4bdff42ae1faf3c87e451b0a6ab241415517135e38a13a97bb4abd3d`.
Both bind the same previously exposed PDF page 18/index 17, source and viewport.
The private plan, source snapshots, component records, masks and overlays are
retained. Source archives preserve this executed implementation if later
experiments use a different polygonizer or boundary hypothesis.

Five fabricated tests verify observed versus missing doorway behavior, preserved
column holes, closing accounting, unresolved open edges and invalid input
rejection. These tests validate the algorithm's stated behavior, not accuracy
on drawings. Run them with the existing research environment:

```bash
python -m unittest discover -s scripts/rooms/wall-probe -p 'test_partition_saved.py' -v
```

No thresholds were searched after seeing these results. Any new method needs a
new declared experiment; do not overwrite this output or present it as approved
training data.
