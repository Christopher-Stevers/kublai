# Wall-model input audit

The follow-on [saved-mask topology probe](PARTITION_RESULTS_2026-10-02.md) shows
why plausible wall predictions alone still do not produce complete room outlines.

## Yytsi/floorplan-to-3d — rejected before inference, 2026-10-02

**This checkpoint is not a defensible complementary raw-raster wall detector
for ForemanHQ.** Its training and supported inference inputs are rendered,
semantically filtered CubiCasa annotations. No weights were downloaded, no GPU
trial ran, and no private drawing or protected evaluation corpus was opened for
this audit. This conclusion concerns input compatibility, not measured accuracy.

Pinned source: `ccc19723d98b097b521b8289287c5143e535df0d`.
Pinned Hugging Face revision: `68843a3ab7b12aa03b23c36f955a0d8099b4e2ee`.
Root resolved both through the primary provider APIs. Machine-readable status
and the published, **not locally verified**, checkpoint checksum are in
[`yytsi-audit.json`](yytsi-audit.json).

| Primary evidence | Finding |
| --- | --- |
| [data.py, lines 94–108](https://github.com/Yytsi/floorplan-to-3d/blob/ccc19723d98b097b521b8289287c5143e535df0d/src/buildingcv/data.py#L94-L108) | Each sample renders `model.svg` into RGB and derives its target from that same SVG. It does not load the original drawing PNG. |
| [data README](https://github.com/Yytsi/floorplan-to-3d/blob/ccc19723d98b097b521b8289287c5143e535df0d/data/README.md) | Identifies `F1_original.png` as the floor plan and `model.svg` as its annotation. |
| [svg_render.py, lines 28–84](https://github.com/Yytsi/floorplan-to-3d/blob/ccc19723d98b097b521b8289287c5143e535df0d/src/buildingcv/svg_render.py#L28-L84) | Removes whole subtrees by semantic class: furniture, fixtures, dimensions, labels and other annotations. Renders the remainder on RGB(124,116,104). ForemanHQ cannot reproduce that cleanup from raw pixels without already recognizing those objects. |
| [svg_to_mask.py, lines 55–77](https://github.com/Yytsi/floorplan-to-3d/blob/ccc19723d98b097b521b8289287c5143e535df0d/src/buildingcv/svg_to_mask.py#L55-L77) | Targets inherit object-class tokens and polygon geometry from the annotated SVG. |
| [extract_polygons.py, lines 111–144](https://github.com/Yytsi/floorplan-to-3d/blob/ccc19723d98b097b521b8289287c5143e535df0d/src/buildingcv/extract_polygons.py#L111-L144) | Inference repeats the same annotation-aware rendering. A PNG adapter would change the input distribution rather than reproduce the author's supported workflow. |

The [pinned model card](https://huggingface.co/Yytsi/floorplan-to-3d-walls/blob/68843a3ab7b12aa03b23c36f955a0d8099b4e2ee/README.md)
reports validation mIoU 0.983 at epoch 26. The code establishes that the published
pipeline evaluates annotation-rendered inputs; this number is **not evidence of
98.3% accuracy on original architectural drawings**, nor a room-recall measure.
The model uses ResNet-34/UNet, four pixel classes, 512×512 aspect-preserving
letterboxing, and ImageNet normalization. Those choices do not remove the
input dependency. We did not establish a class-specific color shortcut and do
not claim one; semantic annotation-based removal is sufficient to reject this
candidate for the proposed raw-source trial.

The [source license](https://github.com/Yytsi/floorplan-to-3d/blob/ccc19723d98b097b521b8289287c5143e535df0d/LICENSE)
and model card specify MIT. The original training dataset separately states
[CC BY-NC 4.0](https://github.com/CubiCasa/CubiCasa5k/blob/master/LICENSE).
This audit does not treat a model-card license as permission to redistribute
or retrain on that dataset. No dataset was downloaded.

No model harness was added: the prerequisite input check failed. Keep this
record so the impressive self-reported score does not trigger the same
inapplicable experiment again. A different model trained on actual drawing
rasters should be checked independently.

## Original CubiCasa5k — fixed raw-raster probe

The official [raster loader](https://github.com/CubiCasa/CubiCasa5k/blob/c34440266665a11f4484eb06cd2e4b7d72ad76c1/floortrans/loaders/svg_loader.py#L47-L94)
passes the input gate: it reads `F1_scaled.png` or `F1_original.png` as RGB;
SVG annotations supply targets separately. Its input normalization is
`2 * RGB / 255 - 1`. This is a different model and task from Yytsi's renderer.

Frozen source revision: `c34440266665a11f4484eb06cd2e4b7d72ad76c1`.
The author-linked Google Drive checkpoint is 208,651,193 bytes, downloaded by
root with SHA256 `dd20b4e1bf1d670f2125107b079df06958b1ccd36e49a464ab739aeb00b8e7a2`.
Its `model_state` contains 740 keys. `adapter.py` verifies exact model-source
and checkpoint bytes, uses `weights_only=True` without an allowlist, and loads
the 44-output architecture strictly. It removes only the unused
`model_1427` import and never invokes the separate pose-pretraining loader.
The author's forward implementation remains unchanged.

`trial.py` is one fixed qualitative test: full sheet, west upper, west lower,
north common, and east upper, with exactly the ROIs in the earlier Raster2Seq
baseline. It accepts only the authorized page-18 text-free PNG fingerprint.
All inputs and outputs remain private. There is no dataset loader, room
polygon generation, morphological repair, confidence sweep, or training.

The probe bounds each crop to a 1024-pixel longest side without upscaling,
preserves aspect ratio, then centers it in a square padded to a multiple of 256.
Padding has normalized value zero. It runs one orientation, unlike the
author's native-size, four-rotation evaluation. That resource-bounded change
is recorded in `plan.json`; results cannot reproduce the author's benchmark.
The process caps its GPU allocator at half the device, sets four CPU threads,
and bounds each view to 90 seconds, with an external 600-second process limit.

Outputs preserve wall, window and door logits and per-head softmax
probabilities; opening heatmap channels are the author's existing sigmoid
activations, **not raw logits**. The model's room head is channels 21–32 (wall
index 2); icon head is channels 33–43 (window index 1, door index 2), following
[official evaluation](https://github.com/CubiCasa/CubiCasa5k/blob/c34440266665a11f4484eb06cd2e4b7d72ad76c1/eval.py#L12-L49).
NPZ arrays remain in model-canvas coordinates. Each JSON records the exact
crop, padding and resize transform; source overlays use per-head argmax with
nearest-neighbor mapping back to the original crop. Red is wall, orange is
door, and blue is window; openings overlay walls where both heads fire.

Run the six fabricated adapter checks before any probe:

```sh
"$PY" -m unittest discover -s scripts/rooms/wall-probe -p 'test_*.py' -v
timeout --kill-after=10s 600s "$PY" scripts/rooms/wall-probe/trial.py \
  --cache /home/tim/datasets/foremanhq-room-detection/wall-probe/cubicasa-official \
  --source /home/tim/datasets/foremanhq-room-detection/stream-vector/verified-page18-textfree-20261001.png \
  --output /home/tim/datasets/foremanhq-room-detection/wall-probe/cubicasa-official/trial-raw5-20261002
```

Use an isolated research Python with the existing PyTorch/NumPy/Pillow runtime;
this harness installs nothing. The output directory must not already exist.
Execution receipts and source snapshots are mandatory; logits alone carry no
room-accuracy score. The official repository's [license](https://github.com/CubiCasa/CubiCasa5k/blob/c34440266665a11f4484eb06cd2e4b7d72ad76c1/LICENSE)
states CC BY-NC 4.0; this private evaluation does not establish permission for
commercial deployment. No original CubiCasa dataset is downloaded.

### Fixed five-view result, 2026-10-02

Root executed the frozen adapter once; all five views completed. Independent
inspection of their source overlays finds a useful structural signal, with
substantial remaining errors. This establishes neither room recall nor wall
accuracy: these are overlapping views of one exposed development drawing,
without complete human-verified room or pixel ground truth.

| View | Qualitative observation and remaining failure |
| --- | --- |
| Full sheet | Main wing and north-block walls are visible, but many thin interior partitions vanish at this scale. Sheet borders and some exterior areas activate falsely. |
| West upper | Recovers many faint bathroom partitions and corridor boundaries while mostly ignoring fixtures, dimension markers and revision clouds. Some gray wall spans remain absent or fragmented. |
| West lower | Finds major walls, stair boundaries and some gray bathroom partitions. Many other gray subdivisions remain missing, with possible false openings and short stray segments. |
| North common | Wall and opening activations largely follow the building structure, including smaller rooms. Most parking stall lines and fixtures remain uncolored. Some spans are incomplete; the lower-right exterior edge activates falsely. |
| East upper | Recovers multiple faint bathroom partitions inside the revision clouds, but misses other gray subdivisions. A long false wall activates in the exterior dimension area at the right. |

Thin red revision-cloud lines already occur in the original source; they are
not model output. The translucent red wall mask should be distinguished from
those lines when reviewing the overlays. Orange opening activations are not
verified door closures, and wall masks alone are not room boundaries.

The accepted private report is
`/home/tim/datasets/foremanhq-room-detection/wall-probe/cubicasa-official/trial-raw5-20261002/report.json`,
SHA256 `ccc0844b4bdff42ae1faf3c87e451b0a6ab241415517135e38a13a97bb4abd3d`.
Its plan SHA256 is
`bf062adaf24d16b814dfbafd4632c84fa7159513bca51e881e801a21d0044250`.
The source PNG SHA256 is
`0047f9a9c46b0a5e8770be18a7fbaefd1dd80496d3c24fa09cd233ea0a591828`,
rendered from original PDF page 18, zero-based index 17. All 40 output hashes,
the plan hash, and 13 current-source/archive bindings were independently
rechecked after execution. The committed Python files match those archives.

Recorded elapsed time is 8.775 seconds, with individual view inference and
transfer times of 0.086–0.198 seconds. Peak allocated GPU memory is 742.67 MiB
(reserved 1400 MiB), peak process RSS 2780.16 MiB, on an RTX 5060 Ti with
PyTorch 2.12.0+cu130. The six adapter fixtures pass. These measurements describe
this exact five-view probe, not whole-app latency or a production resource SLA.

Decision: retain the saved logits as an offline structural hypothesis for a
separately declared deterministic partition experiment. Do not promote the
checkpoint to the commercial app: the source license is CC BY-NC 4.0 and no
commercial checkpoint grant has been established. No app, database, training
corpus or protected evaluation drawing was modified or inspected by this probe.
