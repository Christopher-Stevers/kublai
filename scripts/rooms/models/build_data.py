"""Private synthetic training data with protected-site exclusion.

Verified real reviews use context_review_data.py; shared target helpers below
remain available to that guarded adapter.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import random
import sys

import numpy as np
from PIL import Image, ImageDraw
from shapely import wkt
from shapely.geometry import MultiPolygon

from common import HEADS, REPO, VERSION, file_hash, private_dir, source_hashes, write_json

sys.path.insert(0, str(REPO / "scripts/rooms/complete"))
from evaluate_feedback import complete_floor, private_file, shape_polygon, validate_export

EXCLUDED_TYPES = {"SHAFT", "BALCONY", "TERRACE", "OUTDOOR"}
# Shared by the guarded context-review adapter, not an ingestion path here.
FEEDBACK_ADAPTER = REPO / "scripts/rooms/complete/evaluate_feedback.py"


def model_split(group: str) -> str:
    return "validation" if int(hashlib.sha256(group.encode()).hexdigest()[:8], 16) % 5 == 0 else "train"


def protected_sites(manifest: Path) -> set[str]:
    rows = json.loads(manifest.read_text())
    if not isinstance(rows, list) or not rows or any("site" not in row for row in rows):
        raise ValueError("A complete protected MSD evaluation manifest is mandatory")
    return {str(row["site"]) for row in rows}


def draw_shapes(shapes, width: int, height: int, coordinate) -> tuple[np.ndarray, np.ndarray]:
    inside = np.zeros((height, width), dtype=bool)
    boundary = Image.new("L", (width, height), 0)
    edge = ImageDraw.Draw(boundary)
    for shape in shapes:
        interior = Image.new("L", (width, height), 0)
        fill = ImageDraw.Draw(interior)
        pieces = list(shape.geoms) if isinstance(shape, MultiPolygon) else [shape]
        for polygon in pieces:
            outer = [coordinate(x, y) for x, y in polygon.exterior.coords]
            fill.polygon(outer, fill=255)
            edge.line(outer, fill=255, width=4, joint="curve")
            for ring in polygon.interiors:
                points = [coordinate(x, y) for x, y in ring.coords]
                fill.polygon(points, fill=0)
                edge.line(points, fill=255, width=4, joint="curve")
        inside |= np.asarray(interior) > 0
    edges = np.asarray(boundary) > 0
    return inside & ~edges, edges


def instance_masks(shapes, width: int, height: int, coordinate) -> np.ndarray:
    truth = np.zeros((height, width), dtype=np.int32)
    for ident, shape in enumerate(shapes, 1):
        image = Image.new("L", (width, height), 0)
        draw = ImageDraw.Draw(image)
        for polygon in list(shape.geoms) if isinstance(shape, MultiPolygon) else [shape]:
            draw.polygon([coordinate(x, y) for x, y in polygon.exterior.coords], fill=255)
            for ring in polygon.interiors:
                draw.polygon([coordinate(x, y) for x, y in ring.coords], fill=0)
        truth[np.asarray(image) > 0] = ident
    return truth


def synthetic_floor(record: dict, seed: int) -> tuple[Image.Image, np.ndarray, np.ndarray, np.ndarray]:
    """MSD areas create simulated ink, not the original construction drawing."""
    rng = random.Random(seed)
    shapes = []
    for room in record["rooms"]:
        if room["entity_type"] != "area" or room["entity_subtype"] in EXCLUDED_TYPES:
            continue
        shape = wkt.loads(room["geom"])
        if not shape.is_valid:
            shape = shape.buffer(0)
        if not shape.is_empty and shape.area > 0.3:
            shapes.append(shape)
    if len(shapes) < 3:
        raise ValueError("Insufficient interior room geometry")
    minx = min(s.bounds[0] for s in shapes)
    miny = min(s.bounds[1] for s in shapes)
    maxx = max(s.bounds[2] for s in shapes)
    maxy = max(s.bounds[3] for s in shapes)
    scale = 920 / max(maxx - minx, maxy - miny)
    width, height = 1024, max(200, math.ceil((maxy - miny) * scale) + 104)
    coordinate = lambda x, y: ((x - minx) * scale + 52, (maxy - y) * scale + 52)
    interior, boundary = draw_shapes(shapes, width, height, coordinate)
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    wall_width = rng.choice([1, 2, 3, 4, 5, 6])
    shade = rng.choice([0, 30, 90, 150, 190])
    wall_color = (shade, shade, shade)
    openings = Image.new("L", (width, height), 0)
    od = ImageDraw.Draw(openings)
    doors = []
    for shape in shapes:
        for polygon in list(shape.geoms) if isinstance(shape, MultiPolygon) else [shape]:
            for ring in [polygon.exterior, *polygon.interiors]:
                points = [coordinate(x, y) for x, y in ring.coords]
                draw.line(points, fill=wall_color, width=wall_width, joint="curve")
                # Simulated door gaps are selected away from corners. Actual
                # door semantics are not present in this MSD JSON release.
                for left, right in zip(points, points[1:]):
                    dx, dy = right[0] - left[0], right[1] - left[1]
                    length = math.hypot(dx, dy)
                    if length < 35 or rng.random() > 0.08:
                        continue
                    midpoint = ((left[0] + right[0]) / 2, (left[1] + right[1]) / 2)
                    half = rng.uniform(4, 9)
                    start = (midpoint[0] - dx / length * half, midpoint[1] - dy / length * half)
                    end = (midpoint[0] + dx / length * half, midpoint[1] + dy / length * half)
                    od.line([start, end], fill=255, width=wall_width + 4)
                    doors.append((start, dx / length, dy / length, half * 2))
    # Erase after drawing every shared boundary, otherwise the adjacent room
    # redraws a gap and produces dishonest opening supervision.
    opening = (np.asarray(openings) > 0) & boundary
    erased = Image.fromarray(np.uint8(np.asarray(openings) > 0) * 255)
    image.paste("white", mask=erased)
    draw = ImageDraw.Draw(image)
    for start, ux, uy, length in doors:
        side = rng.choice([-1, 1])
        end = (start[0] - uy * length * side, start[1] + ux * length * side)
        draw.line([start, end], fill=wall_color, width=1)
        angle = math.degrees(math.atan2(uy, ux))
        a, b = sorted([angle, angle + side * 90])
        draw.arc((start[0] - length, start[1] - length, start[0] + length, start[1] + length),
                 a, b, fill=wall_color, width=1)
    # Explicit nonstructural nuisances. These are procedurally drawn distractors
    # and do not establish generalization to genuine fixtures or scanned text.
    locations = np.argwhere(interior)
    for _ in range(min(100, len(shapes) * 3)):
        if not len(locations):
            break
        y, x = locations[rng.randrange(len(locations))]
        if rng.random() < 0.5:
            draw.text((int(x), int(y)), rng.choice(["ROOM", "DIM 1200", "2 BEDROOM", "NOTE", "A-101"]), fill="black")
        else:
            draw.rectangle((int(x), int(y), int(x) + rng.randrange(8, 22), int(y) + rng.randrange(6, 18)), outline="black", width=1)
    for _ in range(min(6, len(shapes))):
        y, x = locations[rng.randrange(len(locations))]
        for step in range(0, 35, 5):
            draw.line((int(x), int(y) + step, int(x) + 25, int(y) + step), fill="black", width=1)
    for _ in range(5):
        x, y = rng.randrange(20, width - 20), rng.randrange(20, height - 20)
        draw.ellipse((x - 7, y - 7, x + 7, y + 7), outline="black", width=1)
        draw.text((x - 3, y - 3), "A", fill="black")
    if rng.random() < 0.5:
        for x in range(30, width, rng.randrange(100, 180)):
            for y in range(15, height, 12):
                draw.line((x, y, x, y + 4), fill=(150, 150, 150), width=1)
    if rng.random() < 0.7:
        # Revision-cloud markup is a closed colored path but not a room wall.
        # Keep RGB throughout training/inference so this cue is not discarded.
        cx, cy = rng.randrange(100, width - 100), rng.randrange(70, max(71, height - 70))
        rx, ry = rng.randrange(45, 110), rng.randrange(30, 60)
        cloud = []
        for i in range(361):
            angle = i * math.pi / 180
            scallop = 1 + 0.09 * math.cos(18 * angle)
            cloud.append((cx + rx * scallop * math.cos(angle), cy + ry * scallop * math.sin(angle)))
        draw.line(cloud, fill=rng.choice([(190, 35, 30), (150, 40, 80)]), width=rng.choice([1, 2, 3]))
    target = np.stack([interior, boundary, opening]).astype(np.uint8)
    return image, target, np.ones_like(target, dtype=np.uint8), instance_masks(shapes, width, height, coordinate)


def reviewed_targets(floor: dict, width: int, height: int) -> tuple[np.ndarray, np.ndarray]:
    """Positive manual additions count; no rejection is painted as background."""
    shapes = [shape_polygon(room["shape"]) for room in floor["approvedRooms"]]
    interior, boundary = draw_shapes(shapes, width, height, lambda x, y: (x * width, y * height))
    target = np.stack([interior, boundary, np.zeros_like(boundary)]).astype(np.uint8)
    known = np.zeros_like(target)
    if complete_floor(floor):
        # Only a current explicit completeness attestation justifies dense
        # interior/background and boundary supervision.
        known[:2] = 1
    else:
        known[0] = interior | boundary
        # An approved room's interior is also known not to be its boundary.
        # Only supervising positive edge pixels encourages barriers everywhere;
        # pixels outside approved geometry remain unknown, including rejections.
        known[1] = interior | boundary
    # Reviewed polygons do not distinguish physical walls from virtual door
    # closures. Opening targets remain unknown, even on complete floors.
    return target, known


def verified_review_floor(floor: dict, examples: list[dict], source_hash: str) -> dict:
    """Partial positives require immutable approval against the copied PDF bytes."""
    source = floor.get("sourceDrawing", {})
    if source.get("sha256") != source_hash:
        raise ValueError("Review source bytes do not match the supplied snapshot")
    if complete_floor(floor):
        return floor
    current = {room["id"]: room for room in floor["approvedRooms"]}
    positives = []
    for example in examples:
        room = current.get(example.get("id"))
        if (room is None or example.get("decision") != "approved" or
                example.get("sourceReviewHash") != source_hash or example.get("corrected") is None):
            continue
        shape = shape_polygon(example["corrected"])
        if not shape.equals(shape_polygon(room["shape"])):
            continue
        positives.append({"id": room["id"], "shape": example["corrected"]})
    return {**floor, "approvedRooms": positives, "completenessReviewed": False}


def store_case(output: Path, ident: str, image: Image.Image, target, known, truth, **metadata) -> dict:
    image_path, target_path = output / f"{ident}.png", output / f"{ident}.npz"
    image.save(image_path)
    np.savez_compressed(target_path, target=target, known=known, truth=truth)
    image_path.chmod(0o600)
    target_path.chmod(0o600)
    return {"id": ident, "image": image_path.name, "targets": target_path.name,
            "image_sha256": file_hash(image_path), "targets_sha256": file_hash(target_path), **metadata}


def build(args) -> dict:
    if getattr(args, "feedback", []):
        raise ValueError("Legacy feedback ingestion is disabled; use context_review_data.py for verified real reviews")
    sources = source_hashes()
    frozen_inputs = {args.msd: file_hash(args.msd), args.protected_manifest: file_hash(args.protected_manifest)}
    protected = protected_sites(args.protected_manifest)
    private_dir(args.output)
    records, counts = [], {"train": 0, "validation": 0}
    for line in args.msd.open():
        if source_hashes() != sources:
            raise RuntimeError("Render source changed during dataset creation")
        record = json.loads(line)
        site = str(record["site_id"])
        if site in protected:
            continue
        group = f"msd-site:{site}"
        split = model_split(group)
        limit = args.train if split == "train" else args.validation
        if counts[split] >= limit:
            continue
        seed = int(hashlib.sha256(f"{args.seed}:{record['id']}".encode()).hexdigest()[:8], 16)
        try:
            image, target, known, truth = synthetic_floor(record, seed)
        except (ValueError, TypeError):
            continue
        records.append(store_case(args.output, record["id"], image, target, known, truth, group=group,
                                  site=site, split=split, source="synthetic-msd", seed=seed,
                                  limitations="Procedural room-boundary/door/nuisance renders; not original construction sheets."))
        counts[split] += 1
        if counts["train"] >= args.train and counts["validation"] >= args.validation:
            break
    if source_hashes() != sources:
        raise RuntimeError("Render source changed before manifest freeze")
    if any(file_hash(path) != digest for path, digest in frozen_inputs.items()):
        raise RuntimeError("Original MSD/protected input bytes changed during dataset creation")
    manifest = {"version": VERSION, "heads": list(HEADS), "seed": args.seed,
                "render_source_hashes": sources,
                "msd_source_sha256": frozen_inputs[args.msd],
                "protected_manifest_sha256": frozen_inputs[args.protected_manifest],
                "excluded_msd_sites": sorted(protected),
                "records": records, "synthetic_counts": counts,
                "license": "MSD JSON: CC BY 4.0, https://zenodo.org/records/17294451.",
                "limitations": "Synthetic validation measures simulated ink only; all outputs are unapproved challengers, not production models."}
    write_json(args.output / "manifest.json", manifest)
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--msd", type=Path, required=True)
    parser.add_argument("--protected-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--train", type=int, default=160)
    parser.add_argument("--validation", type=int, default=40)
    parser.add_argument("--seed", type=int, default=1729)
    args = parser.parse_args()
    if min(args.train, args.validation) < 0 or args.train + args.validation < 1:
        parser.error("Supply nonnegative sizes with at least one generated case")
    os.umask(0o077)
    result = build(args)
    print(json.dumps({"counts": result["synthetic_counts"],
                      "excluded_sites": len(result["excluded_msd_sites"]), "manifest": str(args.output / "manifest.json")}))
