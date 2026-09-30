# Swiss Dwellings physical-wall and true-opening development corpus

The private corpus now contains 80 training and 20 development floorplans from
100 distinct, previously unused sites. Walls, door/window footprints, columns,
fixtures, and area vectors come from pinned Swiss Dwellings v3.0.0 source data.
The drawings themselves are newly generated. No model was trained or scored by
this import, and this corpus is not evidence of every-room accuracy on real sheets.

The compatible current v4 manifest is outside Git:

`/home/tim/datasets/foremanhq-room-detection/models/data-swiss-true-openings-v4-20260930/manifest.json`

Current v4 SHA256:
`619fc06189bd9b6ba1b723ca88c403f89a2ed31c86f628a91408482d9e3fc86b`.

The historical v3 manifest is preserved unchanged:

`/home/tim/datasets/foremanhq-room-detection/models/data-swiss-true-openings-v3-20260930/manifest.json`

The historical v3 SHA256 is
`cc5695d917f4602be043262a48df5de18eed68dfb3876cd5b3815f17465a36f4`.
The first two local corpus versions are superseded development artifacts. V3 is
the immutable target/reference baseline for v4. Its complete committed source is
preserved in Git `0a5cc98` and privately in
`swiss-source-v3-20260930/frozen-v3-sources-0a5cc98/`, with source hashes verified
against the v3 manifest before edits.

## V4 ink augmentation preserves the physical targets

V4 addresses the earlier renderer's restricted dark solid walls. A deterministic
seed selects one of nine styles declared before any model trial: solid gray fills
at 0, 35, 75, 180, or 220, paired white interiors with gray 35/75 outlines at native
one/two-pixel width, or paired light-gray 240/245 interiors with gray 180/220
outlines at native one/two-pixel width. The complete style table and actual counts
are frozen in the v4 manifest. Neither scores nor threshold search choose styles.

All physical wall footprints remain positive in targets, including nearly white
walls and the white interiors between paired lines. True door/window footprints
are erased after every wall fill/outline is drawn. The exact original door
coordinates and source holes remain unchanged.

V4 adds at most 36 simulated furniture rectangles/circles per page, each wholly
inside known indoor source interiors, and 6–12 repeated treads for at most six
source STAIRS features per page, clipped to their known interior footprints.
An independent deterministic RNG places these nuisance marks. They are simulated
ink rather than additional source fixtures, semantic references, or ground truth;
they never become wall/opening targets.

Before WKT replay, v4 requires the exact v3 manifest checksum and the identical
100-case site/building/floor/plan/group/split selection and exclusion list. Each
decoded source-row digest and each target, overview, and reference asset must
equal its v3 hash byte for byte. Styling cannot change the physical semantics,
supervision masks, provisional component labels, or reference geometry. The
stored images are deliberately different. The synthetic pixel-development and
every-room ground-truth restrictions described below apply to both versions.

The completed 100-case metadata comparison confirms unchanged IDs,
site/building/floor/plan/group/splits, transitive aliases, source-row digests, seeds,
exclusions, area-semantic policy and target/overview/reference asset hashes.
All 100 image hashes changed. The private proof is
`data-swiss-true-openings-v4-20260930/ink-v3-v4-identity-proof.json`, SHA256
`d259d4ef2960f8dc0df6a7ad92918da6bb07b95cce8dfa39122521c7739162c1`.
V4 preflight SHA256 is
`ff0f4caa002786a3d92bcf0a18df8d965a9e4724db5174973af64dfae1619a25`.

The frozen actual style counts are 8 solid-0, 12 solid-35, 10 solid-75,
15 solid-180, 14 solid-220, 17 paired-white-1, 10 paired-white-2,
10 paired-gray-1 and 4 paired-gray-2. V4 contains 3,064 simulated furniture marks
and 2,356 repeated stair treads. These counts describe rendered nuisance ink.

## Pinned source and license

[Swiss Dwellings v3.0.0, Zenodo record 7788422](https://zenodo.org/records/7788422)
provides the dataset under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Citation: Standfest, Matthias, et al. *Swiss Dwellings*, v3.0.0.
Zenodo, [doi:10.5281/zenodo.7788422](https://doi.org/10.5281/zenodo.7788422).
Changes made here: independent import, generated sheet rendering, raster targets,
conservative semantics masks, and algorithm-derived component references.
No Archilyse pipeline code is imported or adapted.

The official record metadata is preserved privately, including its license,
creators, version, artifact size, URL, and published checksum. The official ZIP is
931,868,205 bytes with published MD5
`3b7915ecd5bf8e492a3e78c598b74123`.
Only its geometry member was retrieved, using a fixed existing download prefix and
ordinary sequential HTTP 206 byte ranges. **The full archive MD5 was not verified.**

Verified member:

| Field | Value |
| --- | --- |
| ZIP member | `swiss-dwellings-v3.0.0/geometries.csv` |
| Compressed / extracted bytes | 291,005,391 / 1,093,732,415 |
| ZIP CRC32 | `1be5b7b9`, verified after complete extraction |
| CSV SHA256 | `7fa5e6c81102e997c82e2c5355949ccd75f3ff223c10f397b76b136e4a6d0f8f` |
| Member provenance SHA256 | `62cdd7ddc6ff49f43a0d27f88c4045699cc58015f0d809a29239e05a09866eed` |

Private source and retrieval provenance are in
`/home/tim/datasets/foremanhq-room-detection/swiss-source-v3-20260930/`.
The central-directory/range hashes, extracted-member CRC and SHA, official metadata
hash, source URL, attribution, and explicit missing-full-ZIP verification are in
`member-provenance.json`. The archive contains CSV members and no source drawing
images. Source drawings therefore cannot be used to calibrate the renderer's style.

## Exclusions happen before geometry decoding

All four earlier manifests are read only for site/split metadata. No earlier image,
target, annotation, checkpoint, or evaluation geometry is opened. Their exact
metadata hashes are independently pinned in the new importer, so supplying the
pilot twice cannot silently omit the context sites. Duplicate role/hash inputs or
replacement manifests fail closed before WKT decode.

| Frozen role | Metadata SHA256 |
| --- | --- |
| All-spaces geometric, 240 cases / 89 sites | `0a87fe76626ceb927efbe65e63067591fc48e3e780583cb25cf4f8e5816e1d82` |
| Pilot v2, 100 cases | `ce022ade7db2a97e5c31658c40926eef98b6c2e08e44520a5e6fe60fbdafe30d` |
| Context development, 100 cases | `79c22af5e8b2faeac31c6b8b290d292dccc5d9c34db542474edaa79b951a4cac` |
| Original once-only generalization, 20 distinct sites | `f8cb98efb4c35bfc87d27f4c616f82a7b69cc03fa646d960f043f7d490f0d593` |

The exclusion union contains 173 sites. All original 20 once-only sites are
excluded from this corpus and remain unavailable for training, tuning, or rescoring.
Numeric ID aliases such as `012`, `12`, and `12.0` normalize to one identity.
A metadata-only pass through all 3,255,905 source rows joins global site, building,
floor, and plan aliases. Any transitive alias connected to an excluded site is also
excluded. This protects repeated floors/plans across sites and splits before WKT
decoding. No protected WKT is passed to the decoder.

The source contains 13,905 floor records across 1,466 sites. Preflight excludes
1,439 source floor metadata records and 2,861 source aliases. The selected 100
floors are 100 separate alias components. A deterministic metadata-only selection
chooses one floor per component, prefers PUBLIC metadata within a component, and
assigns whole components to training or development. The development set is not an
untouched test set. The selected/source/exclusion hashes and identities are checked
again after decoding/rendering; assets are hashed before and after verification
decoding. The private preflight manifest SHA256 is
`213c51bb2cc87ed6a4c0987c6a70ec423b0299d68695886acc24d2f3646525f4`.

## What the three heads mean

The manifest uses the existing `structural-room-challenger-v1` version,
`whole-sheet-context-v2` experiment, 512-pixel overview, and three-head order:

1. `interior`: union of explicit indoor source area polygons, preserving holes,
   minus physical barrier footprints, undefined/unrecognized areas, and explicit
   nonroom polygons. Staircases and elevators are indoor spaces, as are public
   halls, common rooms, storage, and explicitly named technical rooms.
2. `boundary`: footprints of original `WALL` and `COLUMN` separators and original
   `WINDOW`, `DOOR`, and `ENTRANCE_DOOR` openings. A source wall that overlaps a door
   is erased from the visible drawing at the source opening; the closure remains
   in the structural target. Room/function/unit outlines never create wall targets.
3. `opening_closure`: original `DOOR` and `ENTRANCE_DOOR` footprints only. No
   randomly placed gap or simulated swing arc becomes a positive opening target.

Fixtures and railings are drawn from original coordinates and do not become wall
targets. Sheet frames, title-block boxes, text, wall ink, door swing/leaf
orientations, furniture rectangles/circles and repeated stair treads are simulated.
Original wall thickness and local floor geometry are
preserved under isotropic page scaling; the raster records pixels per source meter.
Targets are 2048 × 1536 pixels. Overview supervision preserves thin barriers and
marks a coarse cell unknown if any contributing source pixel is unknown.

All source area types not explicitly classified as indoor or nonroom remain
unsupervised across all heads. Observed unknown types are `ARCADE`, `CARPARK`,
`GAS`, `NOT_DEFINED`, `OIL_TANK`, and `VEHICLE_TRAFFIC_AREA`. Explicit `AIR`, `SHAFT`,
`VOID`, outdoor/courtyard, balcony, and terrace types are nonroom. The full policy
and source entity/usage counts are stored in metadata. Undefined areas are never
taught as negative interior. No minimum-area filter discards small source spaces.

## Reference and evaluation limits

Each private case preserves source area IDs, unit/apartment IDs, types, unit usages,
physical m², holes, and WKT in a hashed reference JSON. Its area-to-derived-instance
memberships retain all contributing semantic references and overlap counts.
An open living/kitchen component keeps both references rather than receiving an
invented single semantic class. The selected corpus has 2,430 known indoor source
area references, including 699 under 5 m² and 603 hallway/common/elevator/staircase
references. There are 896 PUBLIC area references and 3,143 genuine door objects.
Six cases contain undefined source areas and retain partial supervision.
These counts describe source objects, not independently verified physical rooms.

The stored `truth` array is a provisional four-connected component labeling of the
derived interior cut by physical barriers. It is an algorithm-derived reference,
**not independent manual room ground truth**. Functional areas can split one open
physical space, and raster components can split/merge imperfectly. Every case and
the corpus explicitly state `all_space_scoring_eligible: false`,
`human_completeness_evidence: false`, and
`physical_room_ground_truth_certified: false`. Paired masked pixel-head development
is possible; every-room recall/F1, real-sheet completeness, and production accuracy
must not be inferred from these references. No GPU was used for this import.

## Verification and reproduction

New code is confined to `scripts/rooms/swiss-source/`. All raw CSV/ZIP/WKT, rendered
images, targets, references, and later model checkpoints remain outside Git in
private directories/files with mode 0700/0600.

Seventeen total fabricated tests pass: the twelve preserved source/semantics
tests and the five new v4 style tests. No protected source geometry is read.
The twelve preserved tests cover:
four-manifest metadata union; exact role/hash substitution rejection; protected
site/alias exclusion before WKT; repeated plan/site/floor split isolation; missing
group IDs; genuine door targets; no wall between adjacent open functional areas;
explicit common/hall/elevator/stair/storage/technical references; unknown/outdoor
supervision; holes; and coarse unknown-mask preservation.
The five v4 style tests additionally check all nine styles with nuisance ink
enabled/disabled, exact target/known/truth/reference and coarse-mask bytes,
unchanged source WKT, deterministic repeated images, gray/white wall positives,
post-outline true-opening erasure, and bounded nonstructural fixture/tread ink.

```bash
/home/tim/datasets/foremanhq-room-detection/models/.venv/bin/python \
  scripts/rooms/swiss-source/test_swiss_source.py -v
```

The historical v3 and completed v4 100-case manifest validations pass and check
all asset hashes,
head/overview/image dimensions, binary targets/masks, nonnegative component labels,
all protected/site/plan/floor aliases, and expected split counts. Two selected
unprotected v3 generated pages were inspected visually for geometry,
opening/fixture placement, and page framing. After the v4 source/data freeze, root
also inspected the current unprotected v4 pages `swiss-floor-c6aaa6787aa40f3bd216`
(paired-gray-2) and `swiss-floor-cca1fe164d488e253638` (paired-white-1). Gray paired
walls, genuine portal erasure with simulated arcs, fixture/tread clutter, diagonal
floor geometry and page framing were visible; no rendering blocker was found.
This visual check is rendering QA, not model scoring or independent room-count
annotation.

The historical v3 importer/renderer SHA256 values remain preserved:

| File | SHA256 |
| --- | --- |
| `build.py` | `f4b0ed206ad2ead2969156eccde22ad03d4e21945d70886b33e6f34ae4f0c8a9` |
| `fetch_member.py` | `6447cf40c245fe7284b5081151e80f387377429ffb24bdb1e6217e298478a128` |

The frozen v4 `build.py` SHA256 is
`235eb3408d95929fd63efa689b1f937ce8761c7b7bd521f4959a54b99b9e0935`;
`fetch_member.py` remains unchanged. All 17 total fabricated tests pass, including
the five new style tests, which an independent read-only reviewer reran
successfully. That reviewer also independently confirmed the frozen v3/v4
manifest and comparison-proof checksums and all 100 unchanged identity/target/
reference fields using metadata only.
The 100-case v4 build passes the original hash/head/alias checks and the exact
v3 identity/target/reference comparisons. Source snapshots and their checksums
are retained privately with the final v4 artifacts.

The imported source is feasible for the next guarded custom-model development
trial. It does not certify transfer to the actual A511 drawing, replace human
complete-plan review, or justify promotion to production.
