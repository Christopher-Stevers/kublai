"""Local stitched structural probabilities -> global room polygons, including holes."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import time

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage
from shapely.geometry import Polygon, box
from shapely.ops import unary_union
import torch

from common import HEADS, VERSION, file_hash, private_dir, source_hashes, write_json
from network import StructuralUNet


def starts(length: int, tile: int, overlap: int) -> list[int]:
    if overlap < 0 or overlap >= tile:
        raise ValueError("Overlap must be nonnegative and smaller than tile")
    if length <= tile:
        return [0]
    result = list(range(0, length - tile + 1, tile - overlap))
    if result[-1] != length - tile:
        result.append(length - tile)
    return result


def stitched_probabilities(model, image: np.ndarray, tile: int, overlap: int, device) -> np.ndarray:
    height, width = image.shape[:2]
    sums = np.zeros((len(HEADS), height, width), dtype=np.float32)
    weights = np.zeros((height, width), dtype=np.float32)
    blend = np.maximum(0.05, np.outer(np.hanning(tile), np.hanning(tile))).astype(np.float32)
    with torch.inference_mode():
        for y in starts(height, tile, overlap):
            for x in starts(width, tile, overlap):
                h, w = min(tile, height - y), min(tile, width - x)
                pixels = np.ones((tile, tile, 3), dtype=np.float32)
                pixels[:h, :w] = image[y:y + h, x:x + w]
                tensor = torch.from_numpy(pixels.transpose(2, 0, 1).copy()).unsqueeze(0).to(device)
                with torch.autocast("cuda", dtype=torch.bfloat16) if device.type == "cuda" else torch.autocast("cpu", enabled=False):
                    prediction = model(tensor).sigmoid().float().cpu().numpy()[0, :, :h, :w]
                sums[:, y:y + h, x:x + w] += prediction * blend[:h, :w]
                weights[y:y + h, x:x + w] += blend[:h, :w]
    return sums / weights[None]


def pixel_cell_polygon(binary: np.ndarray) -> Polygon:
    """Exact union of foreground cells, with repeated row spans merged first."""
    rectangles, active = [], {}
    for y, row in enumerate(binary):
        changes = np.diff(np.pad(row.astype(np.int8), (1, 1)))
        spans = set(zip(np.flatnonzero(changes == 1), np.flatnonzero(changes == -1)))
        for (left, right), top in active.items():
            if (left, right) not in spans:
                rectangles.append(box(int(left), top, int(right), y))
        active = {span: active.get(span, y) for span in spans}
    for (left, right), top in active.items():
        rectangles.append(box(int(left), top, int(right), len(binary)))
    polygon = unary_union(rectangles)
    if not isinstance(polygon, Polygon) or polygon.is_empty or not polygon.is_valid or polygon.area <= 0:
        raise ValueError("A retained room component has no valid polygon representation")
    return polygon


def component_polygon(binary: np.ndarray) -> Polygon:
    """Keep narrow connections and holes; never discard a scored component."""
    # Contours on native pixels collapse a one-pixel bridge into a repeated
    # line. Doubling gives every foreground cell a contour with nonzero area.
    doubled = np.repeat(np.repeat(binary, 2, axis=0), 2, axis=1)
    contours, hierarchy = cv2.findContours(doubled, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    polygon = None
    if hierarchy is not None:
        tree = hierarchy[0]
        outer_ids = [i for i, relation in enumerate(tree) if relation[3] == -1]
        if len(outer_ids) == 1:
            outer = outer_ids[0]
            points = contours[outer].reshape(-1, 2) / 2
            holes = [contours[i].reshape(-1, 2) / 2 for i, relation in enumerate(tree) if relation[3] == outer]
            if len(points) >= 3 and all(len(hole) >= 3 for hole in holes):
                candidate = Polygon(points, holes)
                if candidate.is_valid and not candidate.is_empty and candidate.area > 0:
                    polygon = candidate
    # Diagonal contacts can still make contour holes touch their shell along an
    # edge. Reconstruct from the observed cells, rather than repairing a ring
    # with buffer(0), which can silently lose a narrow connection or a hole.
    if polygon is None:
        polygon = pixel_cell_polygon(binary)
    polygon = polygon.simplify(0.5, preserve_topology=True)
    if not isinstance(polygon, Polygon) or polygon.is_empty or not polygon.is_valid or polygon.area <= 0:
        raise ValueError("Room polygonization returned invalid geometry")
    return polygon


def global_rooms(probability: np.ndarray, boundary_threshold: float = 0.5,
                 interior_threshold: float = 0.35, min_area: int = 25) -> tuple[np.ndarray, list[dict]]:
    """One page graph, never a concatenation of independently predicted tile rooms."""
    _, height, width = probability.shape
    barrier = np.maximum(probability[1], probability[2]) >= boundary_threshold
    components, count = ndimage.label(~barrier)
    areas = np.bincount(components.ravel(), minlength=count + 1)
    interior = np.bincount(components.ravel(), weights=probability[0].ravel(), minlength=count + 1)
    border = set(np.concatenate([components[0], components[-1], components[:, 0], components[:, -1]]))
    mapping = np.zeros(count + 1, dtype=np.int32)
    next_label = 1
    for ident in range(1, count + 1):
        if ident not in border and areas[ident] >= min_area and interior[ident] / areas[ident] >= interior_threshold:
            mapping[ident] = next_label
            next_label += 1
    labels = mapping[components]
    rooms = []
    for ident, region in enumerate(ndimage.find_objects(labels), 1):
        if region is None:
            continue
        sy, sx = region
        binary = np.uint8(labels[region] == ident)
        polygon = component_polygon(binary)

        def ring(coords):
            return [{"x": float((x + sx.start) / width), "y": float((y + sy.start) / height)}
                    for x, y in list(coords)[:-1]]

        points = ring(polygon.exterior.coords)
        holes = [ring(interior.coords) for interior in polygon.interiors]
        normalized = Polygon([(p["x"], p["y"]) for p in points],
                             [[(p["x"], p["y"]) for p in hole] for hole in holes])
        if not normalized.is_valid or normalized.is_empty or normalized.area <= 0:
            raise ValueError("Normalized room polygon is invalid; labels may not be scored")
        shape = {"type": "polygon", "points": points, **({"holes": holes} if holes else {})}
        rooms.append({"label": ident, "name": f"Unlabeled space {ident}", "shape": shape,
                      "detection": {"version": VERSION, "basis": "local-structural-model",
                                    "requiresReview": True,
                                    "meanInteriorScore": float(probability[0][region][binary > 0].mean()),
                                    "scoreIsCalibratedConfidence": False}})
    return labels, rooms


def load_model(checkpoint: Path, device):
    saved = torch.load(checkpoint, map_location="cpu", weights_only=True)
    metadata = json.loads(saved["metadata_json"])
    if metadata.get("version") != VERSION or metadata.get("heads") != list(HEADS):
        raise ValueError("Unsupported checkpoint contract")
    current = source_hashes()
    for file in ("network.py", "common.py"):
        if metadata["source_hashes"].get(file) != current[file]:
            raise ValueError("Checkpoint architecture source differs; use an explicit new version")
    model = StructuralUNet(metadata["base"])
    model.load_state_dict(saved["weights"], strict=True)
    return model.to(device).eval(), metadata


def run(args):
    device = torch.device(args.device)
    if device.type == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable")
    torch.set_num_threads(args.threads)
    image = np.asarray(Image.open(args.image).convert("RGB"), dtype=np.float32) / 255
    if image.shape[0] * image.shape[1] > 30_000_000:
        raise ValueError("Image exceeds the bounded 30-megapixel local adapter")
    model, metadata = load_model(args.checkpoint, device)
    private_dir(args.output)
    started = time.monotonic()
    if device.type == "cuda":
        torch.cuda.reset_peak_memory_stats(device)
    probability = stitched_probabilities(model, image, metadata["tile"], args.overlap, device)
    labels, rooms = global_rooms(probability, args.boundary_threshold, args.interior_threshold, args.min_area)
    labels.astype("<i4").tofile(args.output / "labels.i32")
    np.savez_compressed(args.output / "probabilities.npz", probability=probability)
    output = {"version": VERSION, "width": image.shape[1], "height": image.shape[0], "rooms": rooms,
              "input_sha256": file_hash(args.image), "checkpoint_sha256": file_hash(args.checkpoint),
              "training_manifest_sha256": metadata["manifest_sha256"], "source_hashes": source_hashes(),
              "thresholds": {"boundary": args.boundary_threshold, "interior": args.interior_threshold, "minArea": args.min_area},
              "wall_seconds": time.monotonic() - started,
              "peak_cuda_allocated_mib": torch.cuda.max_memory_allocated(device) / 2 ** 20 if device.type == "cuda" else 0,
              "approved_for_production": False,
              "limitations": "Unapproved local challenger; scores are not calibrated confidence, and synthetic training does not establish real-sheet accuracy."}
    write_json(args.output / "prediction.json", output)
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--device", choices=["cuda", "cpu"], default="cuda")
    parser.add_argument("--overlap", type=int, default=128)
    parser.add_argument("--boundary-threshold", type=float, default=0.5)
    parser.add_argument("--interior-threshold", type=float, default=0.35)
    parser.add_argument("--min-area", type=int, default=25)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if not 0 < args.boundary_threshold < 1 or not 0 <= args.interior_threshold <= 1 or args.min_area < 1:
        parser.error("Thresholds and minimum area must be valid")
    os.umask(0o077)
    result = run(args)
    print(json.dumps({"width": result["width"], "height": result["height"], "rooms": len(result["rooms"]),
                      "wall_seconds": result["wall_seconds"], "checkpoint_sha256": result["checkpoint_sha256"]}))
