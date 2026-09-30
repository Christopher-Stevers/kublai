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
  --output /absolute/private-swiss-data --train 80 --development 20
```

These four roles are pinned by metadata hash. Exclusions and transitive
site/building/floor/plan aliases are checked before WKT decoding. Unknown area
semantics remain unsupervised. Physical separators and genuine opening
footprints supply the boundary head; named open-plan zones do not create walls.

Use the three masked pixel heads for development comparisons. The stored
component labels are provisional and cannot establish every-room recall or
floor completeness. Source area types, physical areas and component memberships
are retained privately for later annotation and subgroup analysis.

```bash
/absolute/model-venv/bin/python scripts/rooms/swiss-source/test_swiss_source.py -v
```

See [the measured data report](../../../docs/ROOM_TRUE_OPENING_DATA_2026-09-30.md)
for exact source, dataset and exclusion checksums and the limits of these targets.
