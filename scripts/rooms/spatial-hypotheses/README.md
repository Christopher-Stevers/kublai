# Room hypotheses from repetition and navigation

Two distinct offline experiments, neither enabled in the app:

- `repeat.py`: use a room-shaped example and nearby drawing ink to find repeated,
  reflected and quarter-turned copies. Boundary agreement and contradictory new
  interior strokes can reject a copy. Preserve the example's holes. A copied
  outline always starts **pending**; approval is never inherited.
- `passages.py`: find narrow passages in free floor space using medial-axis
  clearance and wall-face witnesses, then partition across supported cuts. Room
  labels are not required. Keep unlabeled halls; an exterior leak stays unresolved.
- `vector_barrier.py`: one deliberately crude structural-ink hypothesis from the
  streaming paint records. Heavy black strokes are not wall truth. Its loss of
  thin/light walls and inclusion of annotation loops caused poor actual results.

Python needs NumPy, SciPy, scikit-image and Pillow. The research runtime is
`/home/tim/datasets/foremanhq-room-detection/partition/.venv/bin/python`.

```sh
python -m unittest discover -s scripts/rooms/spatial-hypotheses -p 'test_*.py' -v
```

Twelve independent checks cover reflections, rotations, preserved holes,
contradictory walls, unapproved copies, unlabeled circulation, furniture and
exterior leaks. These are fabricated checks, not real-sheet accuracy scores.

**Do not use `trial.py` as a new study runner.** It preserves the original spent
experiment, whose vector input was the adjacent PDF page. Its image-only
conditions remain interpretable; its mixed image/vector conditions are invalid.
`../multiview/paired_trial.py` records the separate corrected study with exactly
the same frozen algorithms/settings and an explicit page-identity check.
Its three repeat candidates are development hypotheses, not approved rooms.

Keep these algorithm files unchanged after the recorded studies. New ideas get
new sources/plans and retained outcomes. See the
[execution report](../../../docs/ROOM_SPATIAL_EXPERIMENTS_2026-10-01.md).
