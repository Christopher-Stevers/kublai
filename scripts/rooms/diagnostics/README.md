# Offline drawing-scale diagnostic

`scale_domain.py` describes the already frozen original context-development 20 pages and Swiss v4 training 80/development 20 pages. It performs no training, inference, detector tuning, service changes or model loading. It never resolves protected or once-only generalization assets.

The exact original context-development ID set is checked before asset access. Swiss functional-area references and connected interior components are **not** independently certified physical rooms. Swiss `truth` arrays are not decoded. The output is descriptive render/target evidence, not a room-accuracy benchmark.

The completed private run is `/home/tim/datasets/foremanhq-room-detection/diagnostics/scale-domain-20260930`. Its report SHA-256 is `dacca3a4d6fc154bf04d5af34a43892344035e2ff51ee0aad76a3a93be85058e`; executed source SHA-256 is `62adab0f87a28509296746135c1c53bd6c594344ea4161e200694c0ac547c5c7`. Images, targets and report remain outside Git. Source/runtime/input hashes are frozen and rechecked at completion.

Fabricated tests, with no corpus access or GPU:

```bash
cd /home/tim/.openclaw/worktrees/foremanhq-reliability/scripts/rooms/diagnostics
/home/tim/datasets/foremanhq-room-detection/partition/.venv/bin/python -m unittest -v test_scale_domain
```

For an explicitly authorized new descriptive run, use the existing CPU runtime and a new private output directory:

```bash
/home/tim/datasets/foremanhq-room-detection/partition/.venv/bin/python scale_domain.py --output /home/tim/datasets/foremanhq-room-detection/diagnostics/NEW_PRIVATE_DIRECTORY
```

The existing result does not need to be regenerated. See [the measured diagnostic and next-experiment proposal](../../../docs/ROOM_SCALE_DOMAIN_DIAGNOSTIC_2026-09-30.md) for metric definitions, limitations and source links.
