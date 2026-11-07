"""Local prompt protocol utilities. Ground truth never selects a model mask."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.ndimage import distance_transform_edt, label
import shapely
from shapely.geometry import Polygon

TINY_SHA256 = "7402e0d864fa82708a20fbd15bc84245c2f26dff0eb43a4b5b93452deb34be69"
SAM_COMMIT = "2b90b9f5ceec907a1c18123530e92e794ad901a4"


def harness_hashes() -> dict[str, str]:
    return {path.name: file_hash(path) for path in sorted(Path(__file__).parent.glob("*.py"))}


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while data := f.read(1024 * 1024):
            h.update(data)
    return h.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")
    path.chmod(0o600)


def validate_points(points: object, width: int, height: int) -> tuple[np.ndarray, np.ndarray]:
    """Accept pixel taps [x, y, 1|0], with at least one positive tap."""
    values = np.asarray(points, dtype=np.float64)
    if values.ndim != 2 or values.shape[1] != 3 or not 1 <= len(values) <= 32:
        raise ValueError("Expected 1 to 32 taps [pixel_x, pixel_y, 1|0]")
    if not np.isfinite(values).all() or not np.isin(values[:, 2], [0, 1]).all():
        raise ValueError("Taps must be finite and labels binary")
    if not (values[:, 2] == 1).any():
        raise ValueError("A positive tap is required")
    if ((values[:, :2] < 0).any() or (values[:, 0] >= width).any()
            or (values[:, 1] >= height).any()):
        raise ValueError("Taps lie outside the image")
    return values[:, :2].astype(np.float32), values[:, 2].astype(np.int32)


def select_mask(masks: np.ndarray, scores: np.ndarray, points: np.ndarray,
                labels: np.ndarray) -> int:
    """Prefer prompt compliance then official predicted IoU, never measured IoU."""
    if masks.ndim != 3 or len(masks) != len(scores) or not np.isfinite(scores).all():
        raise ValueError("Invalid candidate masks or predicted scores")
    x, y = points[:, 0].astype(int), points[:, 1].astype(int)
    violations = (masks[:, y, x] != labels[None, :].astype(bool)).sum(axis=1)
    return min(range(len(masks)), key=lambda i: (int(violations[i]), -float(scores[i]), i))


def interior_tap(mask: np.ndarray) -> tuple[int, int]:
    if not mask.any():
        raise ValueError("Cannot tap an empty region")
    y, x = np.unravel_index(np.argmax(distance_transform_edt(mask)), mask.shape)
    return int(x), int(y)


def correction_tap(truth: np.ndarray, predicted: np.ndarray) -> tuple[int, int, int] | None:
    """Simulate a human correcting the largest connected missed/extra region."""
    choices = []
    for error, tap_label in ((truth & ~predicted, 1), (predicted & ~truth, 0)):
        components, count = label(error)
        if count:
            sizes = np.bincount(components.ravel()); sizes[0] = 0
            region_id = int(np.argmax(sizes))
            choices.append((int(sizes[region_id]), tap_label, components == region_id))
    if not choices:
        return None
    _, tap_label, region = max(choices, key=lambda choice: (choice[0], choice[1]))
    x, y = interior_tap(region)
    return x, y, tap_label


def mask_iou(truth: np.ndarray, predicted: np.ndarray) -> float:
    union = int((truth | predicted).sum())
    return float((truth & predicted).sum()) / union if union else 1.0


def mask_polygons(mask: np.ndarray) -> list[dict]:
    """Union exact pixel-edge row spans, preserving holes and corner contacts.

    OpenCV center-pixel contours can self-cross where pixels touch diagonally,
    dropping whole components under strict validation. This exact area union
    does not guess geometry, fill holes, simplify, or repair a room boundary.
    """
    h, w = mask.shape
    padded = np.pad(mask.astype(np.int8), ((0, 0), (1, 1)))
    change = np.diff(padded, axis=1)
    ys, starts = np.nonzero(change == 1)
    end_y, ends = np.nonzero(change == -1)
    if len(starts) == 0:
        return []
    if len(starts) > 500_000 or not np.array_equal(ys, end_y):
        raise ValueError("Mask complexity exceeds bounded exact polygon export")
    rectangles = shapely.box(starts, ys, ends, ys+1)
    merged = shapely.unary_union(rectangles)
    if not merged.is_valid or abs(merged.area - int(mask.sum())) > 1e-6:
        raise ValueError("Exact pixel geometry failed validation or area conservation")
    components = [merged] if merged.geom_type == "Polygon" else list(merged.geoms)
    result = []
    for shape in components:
        ring = np.asarray(shape.exterior.coords)
        holes = [np.asarray(hole.coords) for hole in shape.interiors]
        result.append({"polygon": (ring / [w, h]).tolist(),
                       "holes": [(hole / [w, h]).tolist() for hole in holes],
                       "area_fraction": shape.area / (w * h)})
    return sorted(result, key=lambda polygon: -polygon["area_fraction"])


def rasterize_polygons(polygons: list[dict], shape: tuple[int, int]) -> np.ndarray:
    """Measure actual emitted geometry as well as the segmentation raster."""
    h, w = shape
    result = np.zeros(shape, bool)
    for polygon in polygons:
        outer = np.asarray(polygon["polygon"]) * [w, h]
        holes = [np.asarray(hole) * [w, h] for hole in polygon["holes"]]
        geometry = Polygon(outer, holes)
        left, top, right, bottom = geometry.bounds
        left, top = max(0, int(np.floor(left))), max(0, int(np.floor(top)))
        right, bottom = min(w, int(np.ceil(right))), min(h, int(np.ceil(bottom)))
        yy, xx = np.mgrid[top:bottom, left:right]
        shapely.prepare(geometry)
        result[top:bottom, left:right] |= shapely.contains_xy(geometry, xx+.5, yy+.5)
    return result


def checked_records(manifest_path: Path, limit: int) -> tuple[dict, list[dict]]:
    """Only the separate context model's development data, never holdout records."""
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("experiment") != "whole-sheet-context-v2":
        raise ValueError("Expected the separate whole-sheet context development manifest")
    excluded = {str(site) for site in manifest.get("excluded_msd_sites", [])}
    records = []
    for record in manifest["records"]:
        if record["split"] not in {"train", "validation"}:
            raise ValueError("Protected/unknown splits are forbidden in this prompt experiment")
        if str(record["site"]) in excluded:
            raise ValueError("An excluded MSD site entered this development manifest")
        if record["split"] == "validation":
            records.append(record)
    if limit < 1 or not records:
        raise ValueError("A positive number of development validation sheets is required")
    return manifest, records[:limit]
