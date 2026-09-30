# Original Swiss wall and opening data

This independent importer supplies genuine wall/opening coordinates to local
model development. It generates images; it does not retrieve original drawing
images, train a model or establish physical-room completeness. Dependencies are
the existing [model runtime requirements](../models/requirements.txt).

Fetch only the geometry CSV member into a new private directory outside Git:

```bash
python scripts/rooms/swiss-source/fetch_member.py \
  --output /absolute/private-swiss-source
```

The downloader requires exact HTTP 206 ranges and validates the extracted member
size/CRC. Its computed SHA256 and range provenance are recorded. It does not
claim to verify the full archive MD5. Retain the official CC BY 4.0 attribution.

Generate a new private dataset with all four prior manifests, in this order:

```bash
/absolute/model-venv/bin/python scripts/rooms/swiss-source/build.py \
  --csv /absolute/private-swiss-source/geometries.csv \
  --provenance /absolute/private-swiss-source/member-provenance.json \
  --prior-manifest /absolute/all-spaces-msd/manifest.json \
  --prior-manifest /absolute/data-pilot-v2-20260930/manifest.json \
  --prior-manifest /absolute/data-context-20260930/manifest.json \
  --prior-manifest /absolute/data-context-generalization-20260930/manifest.json \
  --ink-baseline-manifest /absolute/data-swiss-true-openings-v3-20260930/manifest.json \
  --output /absolute/private-swiss-v4-data --train 80 --development 20
```

These four roles are pinned by metadata hash. Exclusions and transitive
site/building/floor/plan aliases are checked before WKT decoding. Unknown area
semantics remain unsupervised. Physical separators and genuine opening
footprints supply the boundary head; named open-plan zones do not create walls.

The current renderer is ink v4. The pinned v3 baseline must keep SHA256
`cc5695d917f4602be043262a48df5de18eed68dfb3876cd5b3815f17465a36f4`.
It preserves every selected site/split, source-row digest and target/overview/
reference asset hash. Nine predeclared styles vary solid wall shades (including
180/220 gray) and paired polygon outlines with white/light-gray interiors at
native one/two-pixel lines. True openings are erased after all wall ink is drawn.
Deterministic simulated furniture rectangles/circles stay wholly in known indoor
interiors; repeated stair treads are clipped to source STAIRS feature interiors.
These marks add no source fixtures, reference labels, boundaries or ground truth.
Neither styling nor nuisance placement uses model results or threshold searches.

Current verified private manifest:
`/home/tim/datasets/foremanhq-room-detection/models/data-swiss-true-openings-v4-20260930/manifest.json`,
SHA256 `619fc06189bd9b6ba1b723ca88c403f89a2ed31c86f628a91408482d9e3fc86b`.
The separate metadata comparison confirms identical v3 targets, masks,
overviews, semantic references, aliases and splits, with all 100 image hashes
changed. V3 source/data are preserved; the authorized trial uses v4.

Use the three masked pixel heads for development comparisons. The stored
component labels are provisional and cannot establish every-room recall or
floor completeness. Source area types, physical areas and component memberships
are retained privately for later annotation and subgroup analysis.

```bash
/absolute/model-venv/bin/python scripts/rooms/swiss-source/test_swiss_source.py -v
```

See [the measured data report](../../../docs/ROOM_TRUE_OPENING_DATA_2026-09-30.md)
for exact source, dataset and exclusion checksums and the limits of these targets.
