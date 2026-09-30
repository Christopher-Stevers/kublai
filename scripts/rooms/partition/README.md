# Learned marker partition experiment

This CPU-only challenger consumes existing byte-verified long48 interior, boundary and opening maps. It neither retrains a model nor edits production. Inputs are limited to the original 20 context development pages and the clean actual A511 qualitative probe; the exposed once-only 20 sites and protected geometric corpus are rejected.

Markers come only from model evidence: distance-transform h-maxima of pixels with interior ≥.35 and barrier <.25. The flooding domain is interior ≥.15 dilated by three pixels at width 1024, excluding barrier ≥.9. Weighted elevation is max(boundary, opening) + .15 × (1 − interior). Four-neighbor connectivity and zero compactness avoid a square-room prior. Components need area ≥25 pixels and mean interior ≥.35. Scale follows maximum dimension /1024. Support holes are not globally filled.

Exactly three settings are declared before scoring:

| Preset | Peak prominence at width 1024 | Hierarchical merge |
| --- | ---: | --- |
| weighted_basins | 2 px | None |
| hierarchical_basins | 2 px | Merge interfaces whose barrier 90th percentile is <.2 |
| sparse_hierarchical | 4 px | Same weak-interface merge |

Weak-interface merges use only neighbor barrier evidence. Each final four-connected instance becomes an exact union of native pixel cells; its normalized polygon area must equal its scored pixel area. Corridors and holes are retained. Any invalid export or bounded-input failure is recorded as a failed floor, rather than retaining only successful proposals. These mechanisms can still invent partitions or merge real spaces.

Use an independent private CPU runtime; pinned dependencies are in `requirements.txt`. `freeze` checks the known development manifest, cached probabilities, historical learned inference sources, checkpoint, actual source/cache provenance and all three settings. It archives the scoring source and binds the original metadata path before any scoring. `evaluate` consumes one attempt per binding, generates every proposal before decoding that floor's reference, and reports full instance/whole-floor metrics. The historical normal .4 score is reused with explicit provenance; no geometry rerun is claimed.

```bash
/absolute/partition-venv/bin/python -m unittest discover -s scripts/rooms/partition -p 'test_*.py' -v

/absolute/partition-venv/bin/python scripts/rooms/partition/evaluate.py freeze \
  --manifest /absolute/data-context-20260930/manifest.json \
  --checkpoint /absolute/train-context-long-20260930/best.pt \
  --development-report /absolute/eval-roi-context-long-20260930/report.json \
  --cache /absolute/eval-roi-context-long-20260930 \
  --actual-image /absolute/clean-a511-source-textfree.png \
  --actual-prediction /absolute/a511-context-long-20260930 \
  --output /absolute/private-partition-binding

/absolute/partition-venv/bin/python scripts/rooms/partition/evaluate.py evaluate \
  --binding /absolute/private-partition-binding/binding.json --output /absolute/private-partition-development

/absolute/partition-venv/bin/python scripts/rooms/partition/probe.py \
  --binding /absolute/private-partition-binding/binding.json \
  --development-report /absolute/private-partition-development/report.json \
  --output /absolute/private-partition-a511
```

Actual probe selection prioritizes zero-miss floors, then failures, misses, extras, merges and splits on the original development split. No GT seed, expected count, reference crop, new-site result or actual qualitative diagnosis changes the partition settings. Promotion requires complete real-project ground truth and independent evaluation.

The recorded run uses `binding-20260930/binding.json`, `eval-20260930/report.json` and `a511-20260930/` under `/home/tim/datasets/foremanhq-room-detection/partition/`. The actual probe is intentionally pinned to this completed development report and the earlier independently recorded A511 prediction/map digests. A new experiment requires a declared new version and provenance rather than substituting a newly computed map hash. Reader/probe support repairs preserve and validate the original scoring snapshot; current partition/metrics sources must match it, and support hashes are captured before probing. They do not rescore the original run.

[scikit-image watershed](https://scikit-image.org/docs/0.26.x/api/skimage.segmentation.html#skimage.segmentation.watershed) documents the priority flood, explicit markers, masks and compactness. [h-maxima](https://scikit-image.org/docs/0.26.x/api/skimage.morphology.html#skimage.morphology.h_maxima) suppresses small local peaks by prominence. [SciPy EDT](https://docs.scipy.org/doc/scipy/reference/generated/scipy.ndimage.distance_transform_edt.html) supplies native clearance. These general image methods do not establish architectural room accuracy.
