# Wall-model input audit

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
