# Fixed scale-and-sheet corpus builder: source/preflight plan

**These fixed source files do not authorize real execution.** Root must authorize each subsequent phase, and actual build/training results must be recorded separately from this fingerprinted README. The implementation is offline; it does not change prior model, Swiss renderer, partition, protected corpus or production sources.

The [measured scale/domain diagnostic](../../../docs/ROOM_SCALE_DOMAIN_DIAGNOSTIC_2026-09-30.md) motivates one controlled input-distribution correction. The builder consumes only the exact Swiss v4 manifest SHA-256 `619fc06189bd9b6ba1b723ca88c403f89a2ed31c86f628a91408482d9e3fc86b`. It never follows prior/protected provenance paths, loads original context-development pixels, decodes vector CSVs or opens model weights. Source geometry is Swiss Dwellings v3, CC BY 4.0; see [its original publication](https://zenodo.org/records/7788422). Existing native raster targets, gray/paired wall ink and genuine door footprints are reused; no new arbitrary door gap labels are invented.

## Frozen proposed condition

- Same 100 original IDs, source rows, site/alias components, group identities and splits: train 80 / development 20. The 20 are exposed development pages, not an independent test. One floor crop per output; no duplicated floor becomes an independent example.
- Same 2048×1536 native canvas and 512×512 overview. Whole-source cropping removes old title/frame ink and retains every positive physical/interior mask and every unknown source pixel. An eight-pixel bounded halo retains nearby drawing evidence. Door-swing ink extending beyond it can be cropped; source real door footprints cannot.
- Isotropic densities `.4/.7/1.0`, assigned by stable hashed-ID ordering separately per split: train 27/27/26 and development 7/7/6. One predeclared density per floor, no density selection from accuracy. Crop placement is deterministic inside x80..1728 / y80..1440, without a hidden fit-to-box scale or structure clipping.
- Fresh sheet frame/title, 24 dashed dimension grids, up to 32 parking/landscape enclosures, eight revision clouds (RGB and gray), and up to 160 additional bounded fixture loops/treads. Half of the clouds overlap the floor's vicinity. Fixtures are wholly inside known target interiors. Up to 8 parking-style motifs may occupy existing all-head-known-negative pockets inside the crop box, with 12px clearance from positive or unknown support; others stay outside that box. These are simulated nuisance strokes, not inferred parking/void labels. Actual accepted counts are reported and may be below caps.

Pixel transforms use rational pixel-cell overlap weights, not differently rounded horizontal/vertical resize factors. Image colors are area-averaged, with white outside a partly covered final pixel. Boundary/opening targets retain every transformed positive pixel-cell overlap and the opening remains a subset of the boundary. This conservatively expands a raster footprint edge by at most a destination pixel cell. Source entities can become connected after downsampling; no claim of preserved door-entity/component counts or physical-room topology is made.

Any contributing source unknown pixel makes that destination head unknown. Interior uses majority support excluding physical footprints, and mixed interior/background or interior/physical cells remain unsupervised. Thus a hallway too thin to resolve is not taught as a known negative. Genuine opening positives inside source unknown regions are retained with `known=0`. The unchanged future sampler can still anchor on such a positive, so loss/evaluation must apply masks.

Coarse targets are regenerated from the final native target/known arrays: majority interior, any-overlap physical/opening support, unknown whenever any native contributor is unknown, and mixed interior coarse cells also unknown. This is a newly declared supervision contract, not a claim that targets are byte-identical to v4. Image-only nuisance strokes leave target/known bytes unchanged.

Output NPZs contain **only `target` and `known`**; baseline provisional `truth` is never accessed or emitted. The original source references are copied unchanged in source meters. Their old raster memberships refer only to baseline pixels and are explicitly invalid on the transformed raster. Each record includes the source-crop and isotropic affine pixel transform, original reference/source-row digests and a native output receipt. Functional areas and connected components are not certified physical rooms. All records/manifest/completion remain `all_space_scoring_eligible=false`, `physical_room_ground_truth_certified=false`, and `human_completeness_evidence=false`.

## Root preflight and execution plan

1. Review/freeze these four Python files and tests. Run only fabricated checks below. The implementation uses the existing CPU partition runtime (NumPy/Pillow/SciPy), not a new installation or GPU runtime.
2. After root separately authorizes the raw-byte preflight, `build.py freeze` creates the sole private output at `/home/tim/datasets/foremanhq-room-detection/domain-data/swiss-domain-scale-v1-20260930`. It validates the exact manifest/100 metadata associations, snapshots all 400 native baseline assets plus manifest **before decoding**, archives own sources/tests/README and writes `binding.json`. It performs no new rendering. A partial output cannot be silently resumed or substituted.
3. Independent audit inspects the original binding/source/runtime/schedule/asset pins. Root provides `AUDIT_CLEAR.json` with outcome `CLEAR`, scope `one-fixed-domain-data-build`, exact binding SHA-256, exact source-hash dictionary and named reviewer. The builder does not create its own approval. Switching output paths or copying directories fails closed.
4. Only after root authorizes the one real build, `build.py build` consumes the experiment-global claim `/home/tim/datasets/foremanhq-room-detection/domain-data/swiss-domain-scale-v1-20260930.build.claim.json` before the first native asset decode. Every image/target is byte-checked before and after decoding; provisional truth is untouched. Emitted image/NPZ/reference hashes are captured immediately, then rechecked against per-page receipts and final manifest. Sources, archives, runtime, original assets, audit, binding and claim are fenced at completion.
5. Original global completion `/home/tim/datasets/foremanhq-room-detection/domain-data/swiss-domain-scale-v1-20260930.completed.json` pins the original emitted `completed.json`, manifest and exact 501 output/receipt digests. `contract.completed_build()` rejects incomplete/copied/substituted/late-mutated output before any future training adapter decodes it. The separate model wrapper must call this gate and verify arrays/unknown masks itself. No training command is supplied here.

After authorization, planned CLI commands are:

```bash
cd /home/tim/.openclaw/worktrees/foremanhq-reliability/scripts/rooms/domain-data
/home/tim/datasets/foremanhq-room-detection/partition/.venv/bin/python build.py freeze
# Independent preflight audit and root authorization occur between phases.
/home/tim/datasets/foremanhq-room-detection/partition/.venv/bin/python build.py build
```

Fabricated CPU-only checks, permitted now:

```bash
cd /home/tim/.openclaw/worktrees/foremanhq-reliability/scripts/rooms/domain-data
/home/tim/datasets/foremanhq-room-detection/partition/.venv/bin/python -m unittest -v test_domain_data
```

The three output density strata and achieved sparsity/style distributions should be inspected after an authorized build, along with no-clipped-footprint, unknown propagation, per-split count/hash and genuine-door receipts. A future single 48-epoch same-architecture/defaults trial and paired masked-head checks would require additional authorization and a separately frozen model adapter. Suggested GPU budget is roughly 10–20 minutes based on the earlier 9.87-minute / 1.40-GiB trial; no GPU time is reserved or promised. This fixed native page size retains similar host-array scale to v4. There is no new holdout accuracy claim. A511 is a later one fixed qualitative check, and independent complete real-floor annotations remain necessary before promotion.
