"""Strict census output and source/viewport coordinates; no room outlines."""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import re

VERSION = "qwen3-vl-local-census-v2"
CONTEXT_EXPERIMENT = "whole-sheet-context-v2"
CONTEXT_HEADS = ["interior", "boundary", "opening_closure"]
PROTECTED_MANIFEST_SHA256 = "0a87fe76626ceb927efbe65e63067591fc48e3e780583cb25cf4f8e5816e1d82"
# This site exclusion metadata comes from the already-created development
# manifest, not from decoding protected holdout images/targets.
PROTECTED_SITES = frozenset("""1052 1058 1063 1069 1071 1073 1075 1076 1078 1080 1081
1082 1085 1086 1087 1088 1089 1090 1091 1093 1094 1095 1096 1098 1099 1100 1102
1103 1104 1105 1107 1109 1110 1112 1113 1115 1116 1117 1118 1120 1121 1122 1123
1124 1125 1126 1127 1129 1130 1131 1133 1134 1138 1142 1144 1150 1158 1169 1174
1205 125 1260 1278 1280 136 158 1599 1631 164 165 1675 1751 1872 1876 1907 2050
2111 2145 2150 2154 2157 2167 272 30 31 58 712 734 78""".split())
PROMPT = '''Inspect this architectural floor plan viewport using the visible walls and openings.
Identify physically separate interior spaces, including unlabeled rooms, corridors, hallways,
stairs and common areas. A suite/apartment is NOT one room if walls divide it into smaller
rooms. A continuous open hall is one space. Do not mark furniture, wall cavities, dimension
lines, tables, legends, title blocks, parking, landscaping, balconies or outdoor courtyards.
Do not invent rooms where the drawing is unclear. For each visible space, give ONE point
well inside its visible interior. For spaces crossing the viewport edge, place the point in
the visible portion. Use coordinates relative to THIS viewport, from 0 to 1000, x then y.
Also give coarse bounding boxes of the actual building wings, excluding outdoor courtyards
where possible. These boxes are approximate regions, not room boundaries.
Return ONLY valid JSON in this exact schema:
{"building_regions":[{"bbox_2d":[left,top,right,bottom]}],"spaces":[{"point_2d":[x,y],"kind":"room"}]}
Allowed kind values: room, hall, stair, common, unknown. Use unknown when the function is
unclear. Order spaces approximately top to bottom, then left to right. Do not repeat points.
'''


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def source_hashes() -> dict:
    return {path.name: file_hash(path) for path in sorted(Path(__file__).parent.glob("*.py"))}


def checked_development_records(manifest: dict) -> list:
    if (manifest.get("version") != "structural-room-challenger-v1"
            or manifest.get("experiment") != CONTEXT_EXPERIMENT or manifest.get("heads") != CONTEXT_HEADS
            or manifest.get("protected_manifest_sha256") != PROTECTED_MANIFEST_SHA256):
        raise ValueError("Only the frozen context-development contract is allowed")
    excluded = manifest.get("excluded_msd_sites")
    if (not isinstance(excluded, list) or any(not isinstance(s, str) for s in excluded)
            or len(excluded) != len(PROTECTED_SITES) or set(excluded) != PROTECTED_SITES):
        raise ValueError("Protected site exclusion metadata differs or is incomplete")
    records = manifest.get("records")
    if not isinstance(records, list) or not records:
        raise ValueError("Development manifest must contain records")
    identifiers, sites, images = set(), {}, {}
    validation = []
    for record in records:
        if not isinstance(record, dict) or record.get("source") != "synthetic-msd":
            raise ValueError("This pilot accepts synthetic development records only")
        split = record.get("split")
        if split not in {"train", "validation"}:
            raise ValueError("Protected/unknown splits are forbidden")
        ident, site = record.get("id"), record.get("site")
        if not isinstance(ident, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", ident) or ident in identifiers:
            raise ValueError("Case identifiers must be unique plain filenames")
        identifiers.add(ident)
        if not isinstance(site, str) or not site or site in PROTECTED_SITES:
            raise ValueError("Protected/invalid site entered development data")
        if sites.setdefault(site, split) != split:
            raise ValueError("A site crosses train/validation splits")
        for name in ("image", "targets"):
            asset, digest = record.get(name), record.get(f"{name}_sha256")
            if (not isinstance(asset, str) or Path(asset).name != asset or asset in {".", ".."}
                    or not isinstance(digest, str) or not re.fullmatch("[a-f0-9]{64}", digest)):
                raise ValueError("Assets must have plain filenames and exact SHA256 hashes")
        if images.setdefault(record["image_sha256"], split) != split:
            raise ValueError("Identical images cross development splits")
        if split == "validation":
            validation.append(record)
    if len(validation) < 2:
        raise ValueError("At least two development validation records required")
    return validation[:2]


def verify_hashes(files: dict) -> None:
    for path, expected in files.items():
        if file_hash(Path(path)) != expected:
            raise ValueError("Frozen input/source changed; result is not rankable")


def checked_bytes(path: Path, expected: str) -> bytes:
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected:
        raise ValueError("Decoded asset bytes differ from the frozen hash")
    return raw


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write("\n")


def _vector(value, length: int) -> list:
    if not isinstance(value, list) or len(value) != length:
        raise ValueError("Invalid coordinate vector")
    if any(isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n)
           or not 0 <= n <= 1000 for n in value):
        raise ValueError("Coordinates must be finite numbers in [0,1000]")
    return value


def parse_census(text: str) -> dict:
    text = text.strip()
    # A complete markdown fence is tolerated; truncations and JSON fragments are not.
    if text.startswith("```json\n") and text.endswith("\n```"):
        text = text[8:-4]
    value = json.loads(text)
    if not isinstance(value, dict) or set(value) != {"spaces", "building_regions"}:
        raise ValueError("Census must have exactly spaces and building_regions")
    if not isinstance(value["spaces"], list) or not isinstance(value["building_regions"], list):
        raise ValueError("Census collections must be arrays")
    if len(value["spaces"]) > 200 or len(value["building_regions"]) > 20:
        raise ValueError("Census exceeded bounded instance count")
    for space in value["spaces"]:
        if not isinstance(space, dict) or set(space) != {"point_2d", "kind"}:
            raise ValueError("Invalid space object")
        _vector(space["point_2d"], 2)
        if space["kind"] not in {"room", "hall", "stair", "common", "unknown"}:
            raise ValueError("Invalid inferred kind")
    for region in value["building_regions"]:
        if not isinstance(region, dict) or set(region) != {"bbox_2d"}:
            raise ValueError("Invalid building region")
        x0, y0, x1, y1 = _vector(region["bbox_2d"], 4)
        if not x0 < x1 or not y0 < y1:
            raise ValueError("Building region must have positive ordered area")
    return value


def regular_viewports(width: int, height: int) -> list:
    if not isinstance(width, int) or not isinstance(height, int) or min(width, height) < 2:
        raise ValueError("Positive image dimensions of at least two pixels required")
    return [[0, 0, width, height], [0, 0, width // 2, height // 2],
            [width // 2, 0, width, height // 2], [0, height // 2, width // 2, height],
            [width // 2, height // 2, width, height]]


def source_coordinates(census: dict, viewport: list, dimensions: list) -> dict:
    width, height = dimensions
    x0, y0, x1, y1 = viewport
    if not (0 <= x0 < x1 <= width and 0 <= y0 < y1 <= height):
        raise ValueError("Invalid source viewport")
    def point(p):
        x, y = p
        return [x0 + x / 1000 * (x1 - x0), y0 + y / 1000 * (y1 - y0)]
    spaces = []
    for space in census["spaces"]:
        p = point(space["point_2d"])
        spaces.append({"source_point_px": p, "source_point_normalized": [p[0] / width, p[1] / height],
                       "kind_inferred": space["kind"], "seed_origin": "model-inferred"})
    regions = []
    for region in census["building_regions"]:
        a, b = point(region["bbox_2d"][:2]), point(region["bbox_2d"][2:])
        regions.append({"source_bbox_px": a + b, "source_bbox_normalized":
                        [a[0] / width, a[1] / height, b[0] / width, b[1] / height]})
    return {"spaces": spaces, "building_regions": regions, "viewport_source_px": viewport,
            "supplied_seeds": [], "outline_geometry": None}


def point_coverage(truth, points: list) -> dict:
    """One-to-one point-in-interior recall, NOT polygon matching or boundary accuracy."""
    import numpy as np
    if truth.ndim != 2 or not np.issubdtype(truth.dtype, np.integer) or truth.min() < 0:
        raise ValueError("Truth must be nonnegative 2D integer labels")
    identifiers = set(int(n) for n in np.unique(truth) if n > 0)
    covered = set()
    duplicate = 0
    outside = 0
    height, width = truth.shape
    for x, y in points:
        if not math.isfinite(x) or not math.isfinite(y) or not (0 <= x < width and 0 <= y < height):
            outside += 1
            continue
        label = int(truth[math.floor(y), math.floor(x)])
        if label == 0:
            outside += 1
        elif label in covered:
            duplicate += 1
        else:
            covered.add(label)
    missed = len(identifiers - covered)
    return {"expected_rooms": len(identifiers), "predicted_points": len(points), "rooms_hit": len(covered),
            "rooms_missed": missed, "duplicate_room_points": duplicate, "outside_room_points": outside,
            "point_coverage_recall": len(covered) / len(identifiers) if identifiers else None,
            "one_to_one_point_precision": len(covered) / len(points) if points else None,
            "zero_missed_rooms": missed == 0 if identifiers else None,
            "boundary_accuracy": None, "full_floor_detection_accuracy": None}
