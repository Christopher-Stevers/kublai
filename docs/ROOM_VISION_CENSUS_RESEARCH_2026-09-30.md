# Local vision-language room census pilot — September 30, 2026

The tested Qwen3-VL-2B challenger is feasible on this machine, but **both the greedy pilot and the single official-reference sampling control fail on every tested viewport**. It repeatedly generates regular coordinate grids instead of following drawing geometry. The candidate is rejected as a census supplier for ForemanHQ. These points and approximate boxes are **not room outlines, verified detections or completeness evidence**. No production service, detector, customer review, structural-model runtime or SAM runtime was changed.

## Primary-source research

The official [Qwen3-VL-2B-Instruct model card](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct) declares Apache 2.0, provides local Transformers inference and recommends sampling parameters. The [official repository license](https://github.com/QwenLM/Qwen3-VL/blob/main/LICENSE) is also Apache 2.0. This permits a commercially usable local candidate subject to license/attribution conditions. No provider API or remote image upload is required.

The [official grounding cookbook](https://github.com/QwenLM/Qwen3-VL/blob/main/cookbooks/2d_grounding.ipynb) documents relative coordinates from 0 to 1000 and warns about repeated generation and grouped boxes in dense scenes, especially when categories contain more than roughly 40–50 instances. The [Qwen3-VL report](https://arxiv.org/abs/2511.21631) describes spatial and document capabilities; it does not establish exhaustive architectural room recall. Choosing a small local model is therefore a hardware experiment, not an architectural accuracy claim.

Independent primary research supports measuring drawing-specific failure rather than trusting general vision benchmarks. [AECV-Bench](https://arxiv.org/abs/2601.04819) evaluates real architectural counting and drawing QA and finds substantial unresolved symbol/counting errors. [DrawingVQA](https://arxiv.org/abs/2607.15418) reports a model–expert gap on construction drawings. The [zero-shot room-area study](https://pp.bme.hu/ci/article/view/44138) finds much larger VLM geometric errors than deterministic pixel counting even on controlled color-coded plans. These studies test different tasks and cannot be used as ForemanHQ recall measurements.

Other modest candidates exist: official [Qwen3.5-2B](https://huggingface.co/Qwen/Qwen3.5-2B) and [SmolVLM2-2.2B-Instruct](https://huggingface.co/HuggingFaceTB/SmolVLM2-2.2B-Instruct) also declare Apache 2.0. Their public cards do not provide a guarantee of every-room extraction from dense black-and-white construction sheets. They were researched but not downloaded or scored in this bounded pilot. The selected Qwen3-VL candidate has explicit official point/box grounding guidance and a checkpoint below the declared five-GB download bound.

## Frozen local protocol

- Model: `Qwen/Qwen3-VL-2B-Instruct`, official revision `89644892e4d85e24eaac8bacfd4f463576704203`.
- Checkpoint: 4,255,140,312 bytes, SHA256 `7de1838c87a5349b016c26a1c3f7d2bc400a3d485f95ef39a7059ffd734977a0`, verified against official LFS metadata. The complete selected file set is below five GB.
- Runtime: isolated Python 3.12.14, PyTorch 2.12.0+cu130, TorchVision 0.27.0+cu130, Transformers 4.57.6, RTX 5060 Ti, bfloat16, SDPA. Cached PyTorch wheels were reused without changing existing environments.
- The allocator cap is seven GiB; CUDA context/library overhead is separate. Four CPU threads, 786,432 image pixels, 3,072 new tokens and a 120-second per-view generation bound are fixed.
- Inputs: first two validation records in the existing nuisance-development manifest, `sheet-msd-9425` and `sheet-msd-9508`. They were selected by manifest order before scoring. No protected MSD holdout images/labels were read.
- Eleven views: whole images for both development cases; whole image plus four dimension-only quadrants for the first development case and A511. Crops are independent of ground-truth room geometry.
- Every prompt is identical and asks for interior points, inferred function categories and coarse building-wing boxes. No expected room count, GT-derived point, box, polygon or label enters generation. A511 uses its clean local text-free raster and has no complete GT.
- Ground-truth target files are hashed before inference but decoded only by the subsequent scoring command. Scoring measures unique GT interiors containing a predicted point, duplicate points, outside points and misses. It does not measure room polygons or boundaries.
- Model files, source, prompt, input assets, plan, results, viewport origin/size, runtime, token counts and timings are preserved. Each point records `seed_origin: model-inferred`, with empty `supplied_seeds` and null `outline_geometry`.

Complete JSON is required; truncated responses, extra schema objects and invalid coordinates remain failures. No grid salvage, deduplication into apparent rooms, threshold tuning against holdout or automatic model retry is allowed. A failed viewport prevents a completeness success. Output folders and files are private; writes are exclusive and do not overwrite evidence.

## Initial greedy result

All eleven viewports failed acceptance: seven reached the new-token limit, three returned invalid building objects with extra label fields, and one returned coordinates outside the declared range. The total generation/processing wall time was 341.72 seconds. Peak GPU allocation was 4,567.68 MiB, within the seven-GiB cap.

The complete responses also expose grounding failure beyond schema compliance. Several enumerate evenly spaced points or repeat the same locations under multiple function categories. The whole A511 response puts its proposed points along a single x-coordinate with regularly spaced y-values through the large courtyard, while giving an almost whole-page building box. Removing the unexpected label field would not turn these into credible room detections.

The two fully annotated development sheets contain 48 and 39 spaces respectively. Because no response is accepted, the valid-point pipeline hits zero interiors and misses all of them. This is an end-to-end failure count, **not evidence that the underlying model has zero latent spatial understanding**. A511 receives no quantitative room score. There are no validated room boundaries from this experiment.

Private evidence root: `/home/tim/datasets/foremanhq-room-detection/vision-census/`. The original plan is `plan-20260930.json`; immutable responses are in `pilot-20260930/`, original code in `frozen-greedy-source-20260930/`, and report in `report-greedy-20260930.json`. Report SHA256: `73346ef92e60a2e5781ce316e9cb35ff4888dbb41456af2e517f8a1777a5b0bb`.

## Declared sampling control

One control reuses the exact eleven views, images, coordinate protocol and prompt. It resets seed 0 per view, with temperature 0.7, top-p 0.8, top-k 20, repetition penalty 1.0 and presence penalty 1.5 as recommended for vision by the official model card. This is a Transformers implementation of those settings, not a claim of byte-equivalent vLLM output. The presence rule subtracts a fixed logit penalty for tokens already generated, excludes prompt-only tokens and counts repeated generated tokens once, matching the [primary vLLM implementation](https://github.com/vllm-project/vllm/blob/main/vllm/model_executor/layers/utils.py). A focused test verifies that distinction.

The control has a separate plan `plan-sampling-control-20260930.json`, linked to the original plan hash, and immutable output directory. It also fails all eleven views: nine reach the token limit and two return invalid building objects. Total wall time is 376.27 seconds; peak allocation is 4,568.84 MiB. Its complete A511 responses still repeat locations under multiple categories and place proposed points in exterior/page-edge areas. No response is salvaged into an accepted census. No new drawing-specific prompt or GT-derived seed is introduced after seeing the greedy outputs.

| Configuration | Accepted views | Token-limit failures | Other schema/coordinate failures | Total wall seconds | Peak allocated MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Greedy | 0 / 11 | 7 | 4 | 341.72 | 4,567.68 |
| Official-reference sampling | 0 / 11 | 9 | 2 | 376.27 | 4,568.84 |

The control retains the same zero valid-point hits on the 48-space and 39-space development drawings, with no boundary score and no A511 accuracy score. This bounded experiment does not reject every larger, newer or specially trained VLM. It rejects the tested candidate/configurations as a reliable unattended supplier of room interior points.

Immutable source and artifact bindings:

- Greedy plan SHA256: `8ac09bc24fa9e2dd50c0531686df0c1dd5def7b7847410c19c5fc65b5e159434`; original code: `frozen-greedy-source-20260930/`.
- Sampling plan SHA256: `d3e82d4a86434e51aca86bd40d78b9f88c68a561efdc2c22b5f5b3d201b8e8e5`; original code: `frozen-sampling-control-source-20260930/`.
- Sampling report `report-sampling-control-20260930.json` SHA256: `1d71d4d78a4309798eb967c64554fa2d0f0c56bf56c9a24d14b08044205851f1`. Responses: `sampling-control-20260930/`.
- Each report binds exact response hashes and matching source fingerprints; each plan records all image/target/prompt/checkpoint hashes.
- Ten nonweight assets were independently checked against the pinned revision's official Git blob IDs; checkpoint SHA matches official LFS metadata. The private integrity record is `official-model-file-integrity-20260930.json`, SHA256 `c04e5e10cb807823fa24c57c359cfacc5f44c9c685ef83ab13adfdc9d9596007`.

These two immutable **v1 failure diagnostics** predate the finalized-run marker described below. Both inference processes exited successfully after their original final byte checks, but their legacy reports are not accepted by the stricter v2 scoring contract. They will not be retrospectively finalized, used as deployment accuracy evidence or presented as successful room detections.

## Reusable harness

`scripts/rooms/vision/` contains explicit pinned download, frozen-plan generation, offline inference, strict parsing, source-coordinate transforms and post-inference point-coverage scoring. Eighteen focused fabricated protocol tests pass; `py_compile` also passes. Tests cover viewport origins, malformed/truncated outputs, duplicate/missed/outside points, immutable writes/source changes, generation-only presence penalty, whole-manifest split/site isolation, exact model asset identity and completed-run fences. See the [commands and limitations](../scripts/rooms/vision/README.md).

After independent audit, the reusable harness advances to `qwen3-vl-local-census-v2` with these executable guards:

- The development contract requires the expected version, experiment, heads and protected-manifest fingerprint. All records must be synthetic MSD with train/validation splits; the complete known 89-site exclusion set is required. Protected sites, unknown splits, site/image aliases crossing splits, duplicate IDs and escaping asset/ID paths abort before any image/target asset is read.
- All eleven required model assets must match static official sizes and SHA256 values, with exact model/revision/license provenance. Missing/extra config or tokenizer declarations, same-sized changed files and asset symlinks are rejected. The provenance file itself is hashed and fenced.
- A completion marker is written exclusively after final source/plan/runtime/input/model checks and exact hashes of every originally emitted result. Partial/debug `--limit` invocations never finalize. Results changed after emission or a failed final byte check cannot become accepted evidence merely because every viewport filename exists.
- Scoring requires and verifies that complete marker before decoding GT. It binds the entire model/config/tokenizer/provenance map, runtime, input/source hashes and exact result set. Decoded images/targets use the exact in-memory bytes whose hash was verified.

The final Python source bundle SHA256 is `8fa34e5c33dae1920ea7ccd568695a950b9bdc6defb7c889c862da9fdac12f72`, computed from canonical sorted JSON of the per-file `source_hashes()` map. Actual official assets plus provenance (12 entries) passed the final read-only byte verification without model loading or another inference trial.

A fresh independent read-only audit verified that source bundle and ran ten focused fabricated contract/model/finalization tests; all passed with no unresolved blocker in its scope. It accessed no private images, GT or model data and performed no GPU inference. The known safe development manifest also passes the new metadata-only contract check.

No production integration is justified by these results. Future semantic models should be judged on source-separated, fully annotated real projects; room census, boundary quality, unlabeled circulation coverage, false positives, failures and review time need separate measurements. A semantic model could propose a coarse region or review hint, but deterministic geometry and explicit human approval must still validate any resulting outline.
