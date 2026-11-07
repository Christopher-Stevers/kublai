# Isolated local room census challenger

This development harness asks official Qwen3-VL-2B-Instruct for approximate building boxes and one interior point per physical space. It does **not** generate room outlines, validate completeness, approve proposals or change the production app. Model kinds and regions remain unverified. A511 has no complete ground truth and receives qualitative inspection only.

Use an independent private Python environment outside Git. The tested setup uses Python 3.12.14, PyTorch 2.12.0+cu130, TorchVision 0.27.0+cu130 and an RTX 5060 Ti. Do not install into the structural or SAM environments.

```bash
python3.12 -m venv /absolute/private-vision/.venv
/absolute/private-vision/.venv/bin/pip install torch==2.12.0 torchvision==0.27.0 --index-url https://download.pytorch.org/whl/cu130
/absolute/private-vision/.venv/bin/pip install -r scripts/rooms/vision/requirements.txt
/absolute/private-vision/.venv/bin/python -m unittest discover -s scripts/rooms/vision -p 'test_*.py' -v
```

The public checkpoint download is a separate explicit operation. It pins the official revision, checks the Apache 2.0 model-card metadata, bounds the total download below five GB and verifies the official model SHA256. Existing files/results are not overwritten. Retain the original license and attribution when distributing weights or derived work.

```bash
python scripts/rooms/vision/download.py --output /absolute/private-vision/qwen3-vl-2b
```

Freeze the first two existing development validation cases in manifest order and the requested actual sheet before scoring. The v2 harness requires the exact context-development version/experiment/heads and protected-manifest fingerprint, the complete known 89-site exclusion set, and synthetic MSD records with train/validation splits. Every record is checked before asset reading; protected/unknown splits, excluded sites, duplicate IDs, escaping filenames and site/image aliases crossing splits abort. The first development sheet and actual sheet receive the whole image plus four nonoverlapping, dimension-only quadrants. The second development sheet receives the whole image. No ground truth seeds, expected counts, labels, boxes or crops enter prompts. The actual-sheet argument is explicitly supplied for qualitative inspection; do not substitute protected data there.

```bash
/absolute/private-vision/.venv/bin/python scripts/rooms/vision/pilot.py freeze \
  --manifest /absolute/development/manifest.json \
  --a511 /absolute/private/text-free-a511.png \
  --output /absolute/private-vision/plan.json
/absolute/private-vision/.venv/bin/python scripts/rooms/vision/pilot.py infer \
  --plan /absolute/private-vision/plan.json \
  --model /absolute/private-vision/qwen3-vl-2b \
  --output /absolute/private-vision/predictions
/absolute/private-vision/.venv/bin/python scripts/rooms/vision/pilot.py score \
  --plan /absolute/private-vision/plan.json \
  --results /absolute/private-vision/predictions \
  --output /absolute/private-vision/report.json
```

Inference is offline, greedy and bounded to 786,432 image pixels, 3,072 new tokens and 120 seconds per viewport. PyTorch allocations are capped at seven GiB; CUDA context/library overhead is separate and peak allocated/reserved memory is reported. Source, prompt, image, checkpoint, complete config/tokenizer/provenance map and runtime are recorded. Every model asset must match its pinned official size/hash; existing same-sized changed files are rejected. Exact input/source/model hashes are rechecked. Source coordinates preserve the viewport origin and page dimensions. Every point is marked `model-inferred`; `supplied_seeds` is empty and `outline_geometry` is null.

Strict parsing accepts complete JSON and a complete JSON markdown fence. Truncated output, malformed coordinates, unexpected objects or inference failures are preserved as failures without retry, partial-output salvage or geometry invention. Scoring loads ground truth only after the frozen predictions have been produced. It measures unique rooms hit by an interior point, misses, duplicate points and points outside rooms. These are **point coverage metrics**, not room polygon precision/recall, boundary accuracy or a complete-floor accuracy gate. Fixed crops can create duplicate proposals for spaces crossing viewport edges; the score retains that cost.

V2 scoring also requires `completed-run.json`, written only after every planned result and the final source/plan/runtime/input/model fences pass. It binds original emitted result hashes, all model/config/tokenizer/provenance hashes and runtime. A late result mutation or failed finalization cannot be scored. Partial/debug `--limit` invocations retain their outputs but never create a completion marker. The two historical v1 failed trials are preserved with matching source snapshots and are not accepted by this stricter gate; do not fabricate completion markers for legacy results.

One declared parameter control can reuse the identical views/prompt with the official vision sampling recommendation: seed 0 reset per viewport, temperature 0.7, top-p 0.8, top-k 20, repetition penalty 1.0 and presence penalty 1.5. The custom presence processor penalizes generated tokens once and excludes prompt-only tokens; it is tested separately. This is a Transformers implementation of the recommended parameters, not byte-equivalent vLLM sampling.

```bash
/absolute/private-vision/.venv/bin/python scripts/rooms/vision/pilot.py freeze-control \
  --parent /absolute/private-vision/plan.json \
  --output /absolute/private-vision/sampling-control-plan.json
```

Run `infer` and `score` with that separate plan and separate private output paths. A source change invalidates a frozen plan; preserve a verified source snapshot before changing the harness, and use the matching snapshot to replay historical reports. Repeated prompt/model tuning or retrying failed results is a new development experiment and must not be presented as untouched validation.

Research and observed limitations are documented in [the pilot report](../../../docs/ROOM_VISION_CENSUS_RESEARCH_2026-09-30.md).
