"""New model development pages with whole-sheet context and explicit negatives."""
from __future__ import annotations

import argparse
import hashlib
from importlib.metadata import version
import json
import math
import os
from pathlib import Path
import random

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

from build_data import model_split, protected_sites, store_case, synthetic_floor
from common import HEADS, VERSION, file_hash, private_dir, source_hashes, write_json

EXPERIMENT = "whole-sheet-context-v2"
OVERVIEW = 512


def overview_targets(target, known, size=OVERVIEW):
    """Preserve thin barriers; a coarse interior cell must be mostly interior."""
    height, width = target.shape[1:]
    kernel = (max(1, math.ceil(height / size)), max(1, math.ceil(width / size)))
    result = np.zeros((len(HEADS), size, size), dtype=np.uint8)
    mask = np.zeros_like(result)
    for head in range(len(HEADS)):
        # Use the same area footprints as the interior target. Even one unknown
        # contributing pixel makes the entire overview cell unsupervised.
        unknown_fraction = cv2.resize((known[head] == 0).astype(np.float32),
                                      (size, size), interpolation=cv2.INTER_AREA)
        mask[head] = unknown_fraction == 0
        if head == 0:
            result[head] = cv2.resize(target[head].astype(np.float32), (size, size), interpolation=cv2.INTER_AREA) >= 0.5
        else:
            coarse = ndimage.maximum_filter(target[head], size=kernel, mode="nearest")
            result[head] = cv2.resize(coarse, (size, size), interpolation=cv2.INTER_NEAREST)
    return result, mask


def paired_walls(image, target, rng):
    """An explicit nuisance variant, not a reconstruction of MSD wall objects."""
    if rng.random() >= 0.5:
        return image
    edge = target[1].astype(bool)
    opening = ndimage.binary_dilation(target[2], iterations=8)
    outer = ndimage.binary_dilation(edge, iterations=rng.choice([1, 2, 3])) & ~opening
    shell = outer & ~edge
    pixels = np.asarray(image).copy()
    shade = rng.choice([0, 55, 110, 175])
    pixels[outer] = 255
    pixels[shell] = shade
    return Image.fromarray(pixels)


def sheet_case(records, seed):
    """All constituent layouts are from one site and one dataset split."""
    rng = random.Random(seed)
    width = rng.choice([1536, 2048, 3072, 4096])
    height = round(width * rng.uniform(0.7, 0.8))
    image = Image.new("RGB", (width, height), "white")
    target = np.zeros((len(HEADS), height, width), dtype=np.uint8)
    known = np.ones_like(target)
    truth = np.zeros((height, width), dtype=np.int32)
    # U-shaped and separate-wing arrangements intentionally include a large
    # unoccupied courtyard and visible annotations outside the building.
    arrangements = [
        [(0.05, 0.13, 0.28, 0.75), (0.64, 0.13, 0.87, 0.75), (0.29, 0.06, 0.63, 0.30)],
        [(0.06, 0.10, 0.40, 0.48), (0.48, 0.12, 0.82, 0.50), (0.18, 0.56, 0.68, 0.91)],
        [(0.04, 0.09, 0.43, 0.86), (0.47, 0.12, 0.85, 0.90)],
    ]
    boxes = rng.choice(arrangements)
    next_ident = 0
    layouts = []
    for index, normalized in enumerate(boxes):
        record = records[index % len(records)]
        drawing, local_target, _, local_truth = synthetic_floor(record, seed + index * 1009)
        drawing = paired_walls(drawing, local_target, rng)
        if rng.random() < 0.5:
            drawing = drawing.transpose(Image.Transpose.ROTATE_90)
            local_target = np.rot90(local_target, axes=(1, 2)).copy()
            local_truth = np.rot90(local_truth).copy()
        x0, y0, x1, y1 = normalized
        x0, x1 = round(x0 * width), round(x1 * width)
        y0, y1 = round(y0 * height), round(y1 * height)
        # Anisotropic layout scaling is deliberately included as an augmentation
        # and is not an original engineering drawing or measurement.
        w, h = x1 - x0, y1 - y0
        image.paste(drawing.resize((w, h), Image.Resampling.LANCZOS), (x0, y0))
        for head in range(len(HEADS)):
            target[head, y0:y1, x0:x1] = cv2.resize(local_target[head], (w, h), interpolation=cv2.INTER_NEAREST)
        labels = cv2.resize(local_truth, (w, h), interpolation=cv2.INTER_NEAREST)
        labels[labels > 0] += next_ident
        truth[y0:y1, x0:x1] = labels
        next_ident = int(truth.max())
        layouts.append(record["id"])
    draw = ImageDraw.Draw(image)
    line = max(1, width // 1800)
    # Sheet frames and closed title-block boxes are explicitly nonroom targets.
    margin = round(width * 0.018)
    draw.rectangle((margin, margin, width - margin, height - margin), outline=(70, 70, 70), width=line)
    tx = round(width * 0.89)
    draw.line((tx, margin, tx, height - margin), fill=(45, 45, 45), width=line)
    for y in np.linspace(margin, height - margin, 13).astype(int):
        draw.line((tx, y, width - margin, y), fill=(60, 60, 60), width=line)
        draw.text((tx + line * 4, y + line * 4), "REV NOTE LP A511 1200", fill="black")
    # Grid/section bubbles and dashed dimensions surround the occupied regions.
    radius = max(4, round(width * 0.004))
    for x in np.linspace(width * 0.045, width * 0.85, 16).astype(int):
        y = round(height * 0.035)
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), outline=(80, 80, 80), width=line)
        for yy in range(y + radius, height - margin, max(8, width // 90)):
            draw.line((x, yy, x, yy + max(3, width // 220)), fill=(175, 175, 175), width=line)
    # Parking bay dividers, landscaping polygons, and closed revision clouds.
    # They are negative despite forming closed regions: this prevents the model
    # from equating every black enclosure with an interior room.
    for _ in range(rng.randrange(6, 14)):
        x, y = rng.randrange(margin, tx), rng.randrange(margin, height - margin)
        if truth[y, x] != 0:
            continue
        ww, hh = rng.randrange(width // 80, width // 25), rng.randrange(height // 40, height // 15)
        x1, y1 = min(tx - 2, x + ww), min(height - margin, y + hh)
        if np.any(truth[y:y1 + 1, x:x1 + 1]):
            continue
        draw.rectangle((x, y, x1, y1), outline=(120, 120, 120), width=line)
        for xx in range(x, x1, max(4, ww // 4)):
            draw.line((xx, y, xx, y1), fill=(160, 160, 160), width=line)
    for _ in range(3):
        cx, cy = rng.randrange(margin * 3, tx - margin), rng.randrange(margin * 3, height - margin * 3)
        rx, ry = rng.randrange(width // 50, width // 12), rng.randrange(height // 60, height // 15)
        points = []
        for step in range(121):
            angle = step * math.pi / 60
            radial = 1 + 0.08 * math.cos(12 * angle)
            points.append((cx + rx * radial * math.cos(angle), cy + ry * radial * math.sin(angle)))
        draw.line(points, fill=rng.choice([(150, 150, 150), (190, 35, 30)]), width=line)
    coarse, coarse_known = overview_targets(target, known)
    return image, target, known, truth, coarse, coarse_known, layouts


def build(args):
    hashes = source_hashes()
    input_hashes = {"msd_source_sha256": file_hash(args.msd),
                    "protected_manifest_sha256": file_hash(args.protected_manifest)}
    excluded = protected_sites(args.protected_manifest)
    pools = {}
    for line in args.msd.open():
        record = json.loads(line)
        site = str(record["site_id"])
        if site not in excluded:
            pools.setdefault(site, []).append(record)
    if file_hash(args.msd) != input_hashes["msd_source_sha256"] or file_hash(args.protected_manifest) != input_hashes["protected_manifest_sha256"]:
        raise RuntimeError("Dataset source input changed while reading; discard this build")
    private_dir(args.output)
    counts, records = {"train": 0, "validation": 0}, []
    for site in sorted(pools):
        group = f"msd-site:{site}"
        split = model_split(group)
        limit = args.train if split == "train" else args.validation
        for primary in pools[site]:
            if counts[split] >= limit:
                break
            if source_hashes() != hashes:
                raise RuntimeError("Whole-sheet render source changed during build")
            seed = int(hashlib.sha256(f"{args.seed}:{primary['id']}".encode()).hexdigest()[:8], 16)
            rng = random.Random(seed)
            choices = [primary, *rng.sample(pools[site], min(2, len(pools[site])))]
            try:
                image, target, known, truth, coarse, coarse_known, layouts = sheet_case(choices, seed)
            except (ValueError, TypeError):
                continue
            ident = "sheet-" + str(primary["id"])
            record = store_case(args.output, ident, image, target, known, truth, group=group, site=site,
                                split=split, source="synthetic-msd", seed=seed, constituent_layouts=layouts,
                                limitations="Procedural multi-layout sheets, simulated annotations/walls/openings; not construction drawing scans.")
            overview = args.output / f"{ident}-overview.npz"
            np.savez_compressed(overview, target=coarse, known=coarse_known)
            overview.chmod(0o600)
            record.update(overview=overview.name, overview_sha256=file_hash(overview))
            records.append(record)
            counts[split] += 1
            print(json.dumps({"case": ident, "split": split, "size": image.size,
                              "spaces": int(truth.max()), "counts": counts}), flush=True)
        if counts["train"] >= args.train and counts["validation"] >= args.validation:
            break
    if source_hashes() != hashes:
        raise RuntimeError("Whole-sheet render source changed before manifest save")
    if file_hash(args.msd) != input_hashes["msd_source_sha256"] or file_hash(args.protected_manifest) != input_hashes["protected_manifest_sha256"]:
        raise RuntimeError("Dataset source input changed during rendering; discard this build")
    manifest = {"version": VERSION, "experiment": EXPERIMENT, "heads": list(HEADS), "seed": args.seed,
                "overview": OVERVIEW, "records": records, "synthetic_counts": counts,
                "render_source_hashes": hashes, **input_hashes, "excluded_msd_sites": sorted(excluded),
                "render_runtime": {name: version(package) for name, package in
                                   (("numpy", "numpy"), ("pillow", "pillow"), ("opencv", "opencv-python-headless"),
                                    ("scipy", "scipy"), ("shapely", "shapely"))},
                "license": "MSD JSON CC BY 4.0 https://zenodo.org/records/17294451; cite Wassim Jabi and MSD authors.",
                "limitations": "All geometry/ink and nuisance objects are simulated. Domain generalization requires reviewed real projects; no production approval."}
    write_json(args.output / "manifest.json", manifest)
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--msd", type=Path, required=True)
    parser.add_argument("--protected-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--train", type=int, default=80)
    parser.add_argument("--validation", type=int, default=20)
    parser.add_argument("--seed", type=int, default=20260930)
    args = parser.parse_args()
    if min(args.train, args.validation) < 1:
        parser.error("Both train and validation must have positive requested counts")
    os.umask(0o077)
    result = build(args)
    print(json.dumps({"manifest": str(args.output / "manifest.json"), "counts": result["synthetic_counts"]}))
