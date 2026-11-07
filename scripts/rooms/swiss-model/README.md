# Offline true-opening model experiment

This adapter runs one declared random-initialized 48-epoch context U-Net trial on the pinned original Swiss Dwellings development render. It executes a byte-identical archived copy of `models/context_train.py`; architecture, seed, sampler, loss, optimizer and inference fusion are unchanged. No protected corpus pixels or production services are used.

The source's functional areas are not independently certified physical rooms. Evaluation opens only `target` and `known`, never provisional `truth` arrays or room references for matching. Masked native pixel IoU, precision and recall for interior/boundary/opening are **head metrics**, not room recall or floor completeness. The old model's centerline/artificial-gap targets differ from the real wall/window/door footprints; a head improvement demonstrates target adaptation, not a fair room-accuracy ranking.

Training is guarded by a fixed experiment-scoped atomic claim, source/data/runtime snapshots, exact completed 48-epoch and selected checkpoint validation. Failed attempts remain claimed and are not silently restarted. Unknown positive opening pixels are legal but excluded from loss and scores. The unchanged sampler can still center a tile on an unsupervised opening; this limitation is recorded without changing the declared defaults.

The two existing private runtimes remain separate. No package installation is needed. Artifacts/checkpoints stay outside Git.

```sh
MODEL_PY=/home/tim/datasets/foremanhq-room-detection/models/.venv/bin/python
PARTITION_PY=/home/tim/datasets/foremanhq-room-detection/partition/.venv/bin/python
TRIAL=/home/tim/datasets/foremanhq-room-detection/models/train-swiss-true-openings-v4-20260930
EVAL=/home/tim/datasets/foremanhq-room-detection/models/eval-swiss-true-openings-v4-20260930
PROBE=/home/tim/datasets/foremanhq-room-detection/models/a511-swiss-true-openings-v4-20260930

$MODEL_PY scripts/rooms/swiss-model/train_trial.py --output "$TRIAL"
$MODEL_PY scripts/rooms/swiss-model/evaluate_heads.py --binding "$TRIAL/binding.json" --output "$EVAL"
$MODEL_PY scripts/rooms/swiss-model/qualitative.py --binding "$TRIAL/binding.json" --head-report "$EVAL/report.json" --output "$PROBE"
$PARTITION_PY scripts/rooms/swiss-model/partition_actual.py --probe "$PROBE"
```

The actual A511 probe uses its frozen clean text-free RGB page and only the predeclared plain `.4` operating point and previously selected `hierarchical_basins` partition core. Markers come solely from predicted structure. Its overlays/polygons are qualitative falsification, with no real completeness reference or promotion claim.

Fabricated tests use no corpus assets or GPU:

```sh
$MODEL_PY -m unittest discover -s scripts/rooms/swiss-model -p test_contract.py -v
$MODEL_PY -m unittest discover -s scripts/rooms/swiss-model -p test_heads.py -v
$PARTITION_PY -m unittest discover -s scripts/rooms/swiss-model -p test_actual.py -v
```
