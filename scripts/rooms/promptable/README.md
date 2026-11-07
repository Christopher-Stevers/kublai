# Local promptable room-outline experiment

This isolated harness tests official SAM 2.1 tiny for drafting a missed room from a person's positive/negative taps or rough selection box. It does not modify ForemanHQ, upload drawings, use a provider, discover every room, or approve proposals. Weights and predictions remain **unapproved**. Model-predicted IoU is not measured room accuracy or calibrated confidence.

The code and checkpoints have the official [Apache 2.0 license](https://github.com/facebookresearch/sam2/blob/main/LICENSE). Follow its redistribution notices when shipping them. No CubiCasa/LIFULL model or dataset is involved. See [the measured research report](../../../docs/ROOM_PROMPTABLE_MODEL_RESEARCH_2026-09-30.md) before considering integration.

## Separate runtime

Use a fresh Python environment outside Git. Do not install into the structural-model environment. The tested runtime is Python 3.12.14, PyTorch 2.12.0+cu130 and TorchVision 0.27.0+cu130 on an RTX 5060 Ti. CUDA 13 wheels support this machine's GPU in actual inference; older recipes were not tested.

```bash
python3.12 -m venv /absolute/private-promptable/.venv
/absolute/private-promptable/.venv/bin/pip install torch==2.12.0 torchvision==0.27.0 --index-url https://download.pytorch.org/whl/cu130
git clone --depth 1 --filter=blob:none --sparse https://github.com/facebookresearch/sam2.git /absolute/private-promptable/sam2
git -C /absolute/private-promptable/sam2 sparse-checkout set sam2
git -C /absolute/private-promptable/sam2 fetch origin 2b90b9f5ceec907a1c18123530e92e794ad901a4
git -C /absolute/private-promptable/sam2 checkout --detach 2b90b9f5ceec907a1c18123530e92e794ad901a4
SAM2_BUILD_CUDA=0 /absolute/private-promptable/.venv/bin/pip install --no-build-isolation -e /absolute/private-promptable/sam2
/absolute/private-promptable/.venv/bin/pip install -r scripts/rooms/promptable/requirements.txt
curl --fail --location --output /absolute/private-promptable/sam2.1_hiera_tiny.pt https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt
```

The runtime verifies the clean official source commit and checkpoint SHA256 `7402e0d864fa82708a20fbd15bc84245c2f26dff0eb43a4b5b93452deb34be69` before loading it. It never auto-downloads. CUDA postprocessing is disabled explicitly, with zero hole/sprinkle filling; the optional custom kernel is not required. CUDA allocation is capped at 20% by default (at most 25% in the single-prediction CLI), with four CPU threads. This is a standalone bounded experiment, not a production admission/deadline mechanism.

## Tests and prediction

```bash
/absolute/private-promptable/.venv/bin/python -m unittest discover -s scripts/rooms/promptable -p 'test_*.py' -v

/absolute/private-promptable/.venv/bin/python scripts/rooms/promptable/predict.py \
  --checkpoint /absolute/private-promptable/sam2.1_hiera_tiny.pt \
  --image /absolute/private-drawing.png \
  --taps '[[420,360,1],[650,360,0]]' \
  --output /absolute/private-new-prediction
```

Taps are **source-image pixel coordinates**, with `1` meaning inside the intended room and `0` outside it. An optional `--box '[left,top,right,bottom]'` adds a person's rough selection box. `--crop` takes integer source bounds; taps/box retain their source coordinates and are translated into that viewport. The output records normalized polygons **relative to the crop**, holes, crop origin, exact input/checkpoint/source hashes, runtime and timings. A deployment adapter would need to convert crop geometry to original normalized page coordinates, validate a single connected draft and require review. Empty/invalid geometry is not silently repaired.

The mask is selected by tap compliance, then the model's estimated IoU. No measured ground-truth overlap enters selection. All components/holes are retained using an exact pixel-edge union of nonoverlapping row spans. This avoids self-crossings from naive pixel-center contours without guessing new boundaries, filling holes or repairing rooms. Geometry must be valid and conserve the exact foreground pixel area; a 500,000-span complexity limit bounds conversion. This can still produce unusable fragments and fixture/callout holes; the tests do not claim these are rooms.

## Prompted development evaluation

```bash
/absolute/private-promptable/.venv/bin/python scripts/rooms/promptable/evaluate.py \
  --checkpoint /absolute/private-promptable/sam2.1_hiera_tiny.pt \
  --manifest /absolute/private-context-development-data/manifest.json \
  --output /absolute/private-new-prompt-evaluation --sheets 4 --rooms-per-sheet 6
```

Only the separate `whole-sheet-context-v2` development manifest is accepted. It rejects protected/unknown splits and any record whose site is in that manifest's excluded evaluation-site list. Input hashes are verified before and after processing. It does not open the existing geometric holdout, train, retune a detector, access a database, or call an external model.

Three handmade closed/open-door/L-hallway fixtures and a deterministic sample of small, large and elongated development regions are compared under whole-sheet taps, a crop around the intended room, and crop plus rough box. Ground truth supplies an optimistic human's maximum-clearance first tap, then taps in the largest missed/extra connected area, up to five taps. It also supplies crop/box bounds and the stopping rule (IoU >= .98). **These simulated oracle interactions are upper-bound assistance evidence, not automatic room recall**, and need a real-user editing-time test. Reports score both the segmentation raster and emitted valid polygons at pixel centers and require exact mask round-trip. Neither is a full-floor completeness metric.

`qualitative.py` accepts a private JSON array of human-authored cases (`name`, `crop`, pixel `taps`, optional `box`) and generates four input modes on a real drawing without quantitative accuracy claims. Each output directory must be new; JSON/assets are private under an umask of 077. Keep drawings, masks, manifests, checkpoint and environment outside Git.
