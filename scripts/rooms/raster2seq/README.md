# Offline pretrained Raster2Seq proposals

This folder runs fixed qualitative development probes only. It does not activate
a detector, update the app/DB, train a model, or read a reference corpus. Completed
measurements and visual failures are in [RESULTS_2026-10-02.md](RESULTS_2026-10-02.md).
Producer source snapshots, weights, raw inputs, proposals and overlays remain in
the private dataset cache outside Git.

## Pinned dependencies and runtime

- [Official Raster2Seq code](https://github.com/Raster2Seq/Raster2Seq/tree/031f565c4d5d08fc889bbcd873d4afb62dce3676), commit
  `031f565c4d5d08fc889bbcd873d4afb62dce3676`.
- [Official author checkpoints](https://huggingface.co/haopt/Raster2Seq/tree/c9a9c439ba66594dab701b77b7df52a5f75a5fce), revision
  `c9a9c439ba66594dab701b77b7df52a5f75a5fce`.
- Tested Python 3.12.14, torch 2.12.0+cu130, torchvision 0.27.0+cu130,
  numpy 2.5.2, Pillow 12.3.0, shapely 2.1.2, RTX 5060 Ti 16 GiB, driver
  610.57.04. The existing torch build includes `sm_120` and passed a GPU matmul.
- A separate venv at
  `/home/tim/datasets/foremanhq-room-detection/raster2seq/.venv` reads the existing
  promptable venv's site-packages via a `.pth` file. No existing runtime was
  modified. This is a machine-specific setup, not a portable environment lock.

`adapter.py` loads the original architecture and official EMA weights strictly.
It removes only 18 saved decoder runtime cache keys and optional profiler
counters, rather than silently tolerating missing learned weights. Only exact
digest-pinned checkpoints can be decoded, using `weights_only=True` and an
`argparse.Namespace` safe allowlist. Unexpected pickle globals fail; there is no
unrestricted fallback.

The original compiled deformable-attention extension is unavailable on this
machine. The adapter calls the upstream, unchanged PyTorch bilinear `grid_sample`
reference implementation through its original forward API. A fabricated test
checks center interpolation and zero padding. This does not prove bitwise
equivalence to every native CUDA build, and reported timings are for this runtime.
Backward/training paths fail explicitly. Selected upstream enums, argument parser,
generation and postprocessing definitions are extracted verbatim with AST to
avoid importing dataset/evaluation entrypoints. The full checkpoint supplies the
backbone; no ImageNet weight download occurs.

## Data and output contract

Only the explicitly exposed, text-free RGB render of the original PDF page 18
(zero-based 17, sheet A204 / Level 01; app floor called A511) is accepted:

```text
PDF SHA256: 17b15aed60b6b251bfe704a0c2752bab85e196ad3dcfdd2917659bd988991b4f
PNG SHA256: 0047f9a9c46b0a5e8770be18a7fbaefd1dd80496d3c24fa09cd233ea0a591828
```

No protected 89 sites, new once-only 20 sites, reference polygons or user reviews
enter these pilots. The fixed crop boxes are recorded before inference; they are
development probes, not an independent test set. Crops share a page and are not
independent samples. They are not stitched into a full-floor result.

Preprocessing matches the upstream RGB/255, bicubic aspect-preserving resize and
white center padding. Each proposal contains original model pixel points and
`full_page_normalized_points` obtained by the recorded pixel-center inverse.
Out-of-crop coordinates are preserved/flagged, not clamped. The original model
emits single rings and two-point elements, not polygons with holes. The official
postprocessor drops polygons below 100 model pixels of area; raw token/coordinate
generation is preserved so that this omission is visible to future diagnostics.
Two-point elements are counted as lines, not certified doors/windows.

The original baseline has `valid_polygon` flags. New ablation/profile output
additionally uses `export_status: quarantined-invalid` and an invalidity reason.
Consumers must exclude invalid polygons from usable geometry. No `buffer(0)`,
clipping or invented topology repair is performed. Even a strictly valid polygon
is only an unreviewed model proposal, not a correct physical room. Semantic names
are model guesses; the 256 and 512 checkpoints have different class vocabularies.

Each exclusive output directory saves the plan, runtime, current/archive source
SHA256s, input/weight/config pins, raw predictions/logits, source/input/overlay
images, counts and times. Inputs/sources/emitted outputs are rechecked before
`report.json` is written. An interrupted or failed run without a final report is
incomplete. Historical source archives remain authoritative when new support
files are added. The output-directory guard prevents overwrite, not globally
repeated evaluation under another name. No all-space accuracy/completeness
contract is advertised.

## Fixed commands

Run from the v3 clone. Checkpoints are downloaded separately from the immutable
author revision and their exact digests are checked by the adapter; the scripts
never download or upload an input drawing.

```bash
PY=/home/tim/datasets/foremanhq-room-detection/raster2seq/.venv/bin/python
CACHE=/home/tim/datasets/foremanhq-room-detection/raster2seq
SOURCE=/home/tim/datasets/foremanhq-room-detection/stream-vector/verified-page18-textfree-20261001.png

"$PY" -m unittest discover -s scripts/rooms/raster2seq -p 'test_*.py' -v

timeout --signal=TERM --kill-after=15s 600s "$PY" scripts/rooms/raster2seq/trial.py \
  --upstream "$CACHE/upstream" --model "$CACHE/official-cubicasa5k" \
  --source "$SOURCE" --output "$CACHE/page18-fixed-five-view-20261002"

timeout --signal=TERM --kill-after=15s 600s "$PY" scripts/rooms/raster2seq/contrast_trial.py \
  --upstream "$CACHE/upstream" --model "$CACHE/official-cubicasa5k" \
  --source "$SOURCE" --baseline "$CACHE/page18-fixed-five-view-20261002" \
  --output "$CACHE/page18-fixed-contrast-local-20261002"

timeout --signal=TERM --kill-after=15s 600s "$PY" scripts/rooms/raster2seq/profile512.py \
  --upstream "$CACHE/upstream" --model "$CACHE/official-raster2graph-512" \
  --source "$SOURCE" --output "$CACHE/page18-fixed-raster2graph512-20261002"
```

Those historical output directories already exist; these commands describe the
completed runs and intentionally fail rather than overwrite them. Each view has
a 90-second alarm and the commands apply a 600-second process timeout. CUDA
allocator budget is half the device. This does not bound unrelated processes,
CPU RSS, or all GPU memory allocations.

## Licenses and interpretation

The [upstream code license](https://github.com/Raster2Seq/Raster2Seq/blob/031f565c4d5d08fc889bbcd873d4afb62dce3676/LICENSE)
and [official checkpoint model card](https://huggingface.co/haopt/Raster2Seq/blob/c9a9c439ba66594dab701b77b7df52a5f75a5fce/README.md)
declare MIT. The deformable-attention reference source retains its Apache-2.0
notice. Training-data rights are a separate question:
[CubiCasa5K data](https://github.com/CubiCasa/CubiCasa5k/blob/master/LICENSE) are
CC BY-NC 4.0. The [Raster-to-Graph authors](https://github.com/SizheHu/Raster-to-Graph#data)
say their source LIFULL images require separate access and cannot be redistributed
by them; their code repo is GPL-3.0. We did not download those datasets or that
original implementation. The pretrained checkpoint experiments do not establish
rights to use either dataset for commercial retraining or certify production
clearance. Author benchmark scores are not accuracy on this construction sheet.
