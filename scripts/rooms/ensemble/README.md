# Fixed structural component ensemble

The single attempt completed and is rejected as a detector candidate: procedural IoU0.5 recall fell from 86.75% to 53.97%, with 608 misses and 1130 extras. See the hash-pinned completed evidence in the report below. No repeat, threshold search or retraining follows this result.

This is one private, unapproved hypothesis: retain the OLD long48 native/global-fused interior head exactly and replace its boundary/opening heads with the NEW true-opening48 heads exactly. `compose_probability` copies native float32 bits without interpolation, weights, clipping, threshold search or input mutation.

`contract.py` independently pins the two completed checkpoints, original cached maps, actual maps, original context manifest, training completion chain, historical hierarchy report and inference/partition/metric source bytes. It permits only the same original 20 procedural development cases (1321 generated reference spaces). All other source geometry/pixels—including the new once-only 20 sites and protected MSD89—are outside this adapter. Swiss derived physical-space references are never scored.

The frozen `hierarchical_basins` preset is the only partition. References cannot influence markers, crops, thresholds or head composition. The scorer finishes and exports all 20 predictions before decoding the first reference. Failed partitions remain in the original denominator with empty predictions; missing, partial and duplicated case coverage fail closed. Existing exact native pixel-cell exports retain holes.

Each phase requires an independent `AUDIT_CLEAR.json` for the exact frozen binding/source hashes and an exclusive experiment-scoped claim outside output directories. There is no retry, alternate-output reset or CPU inference fallback. Every emitted asset receives an immediate hash receipt; all original inputs, archived/current sources, claims, runtime and emissions are checked again before a completion marker and its global receipt. A partial phase cannot be consumed by the next phase.

The completed attempt used these commands and absolute interpreter paths. Its original phase claims are spent:

```sh
/home/tim/datasets/foremanhq-room-detection/partition/.venv/bin/python scripts/rooms/ensemble/contract.py --output /home/tim/datasets/foremanhq-room-detection/ensemble/fixed-20260930
# Wait for independent source/preflight audit CLEAR for binding.json.
/home/tim/datasets/foremanhq-room-detection/models/.venv/bin/python scripts/rooms/ensemble/run.py inference --binding /home/tim/datasets/foremanhq-room-detection/ensemble/fixed-20260930/binding.json
/home/tim/datasets/foremanhq-room-detection/partition/.venv/bin/python scripts/rooms/ensemble/run.py scoring --binding /home/tim/datasets/foremanhq-room-detection/ensemble/fixed-20260930/binding.json
/home/tim/datasets/foremanhq-room-detection/partition/.venv/bin/python scripts/rooms/ensemble/run.py actual --binding /home/tim/datasets/foremanhq-room-detection/ensemble/fixed-20260930/binding.json
```

Inference reuses the unchanged whole-sheet context loader and RGB tiling, tile512/overlap128/overview512/threads4, on the pinned RTX5060Ti. OLD maps are reused. Actual A511 uses both independently completed cached native maps and the clean text-free source PNG, without new inference. Its room proposals/counts are qualitative review aids, never recall, precision or completeness evidence.

Run the 14 fabricated CPU tests (five composition plus nine identity/attempt/completion/scope tests):

```sh
/home/tim/datasets/foremanhq-room-detection/partition/.venv/bin/python -m unittest discover -s scripts/rooms/ensemble -p 'test_*.py' -v
```

Raw checkpoints, images, probabilities, reference labels and output artifacts stay outside Git. The report is in `docs/ROOM_STRUCTURAL_ENSEMBLE_2026-09-30.md`.
