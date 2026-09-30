"""Three declared learned-evidence watershed challengers, independent of GT."""
from __future__ import annotations

import numpy as np
from scipy import ndimage
from shapely.geometry import Polygon, box
from shapely.ops import unary_union
from skimage.morphology import h_maxima
from skimage.segmentation import watershed

VERSION = "learned-marker-partition-v1"
PRESETS = {
    "weighted_basins": {"prominence_at_1024": 2.0, "merge_quantile90_below": None},
    "hierarchical_basins": {"prominence_at_1024": 2.0, "merge_quantile90_below": 0.2},
    "sparse_hierarchical": {"prominence_at_1024": 4.0, "merge_quantile90_below": 0.2},
}
FIXED = {"support": 0.15, "support_margin_at_1024": 3, "marker_interior": 0.35,
         "marker_barrier": 0.25, "hard_barrier": 0.9, "occupancy_cost": 0.15,
         "minimum_area": 25, "minimum_mean_interior": 0.35,
         "connectivity": 4, "compactness": 0, "maximum_markers": 5000,
         "maximum_pixels": 30_000_000}


def exact_cell_polygon(binary):
    """An exact union of native pixel cells, retaining corridors and holes."""
    rectangles, active = [], {}
    for y, row in enumerate(binary):
        changes = np.diff(np.pad(row.astype(np.int8), (1, 1)))
        spans = set(zip(np.flatnonzero(changes == 1), np.flatnonzero(changes == -1)))
        for (left, right), top in active.items():
            if (left, right) not in spans:
                rectangles.append(box(int(left), top, int(right), y))
        active = {span: active.get(span, y) for span in spans}
    rectangles.extend(box(int(left), top, int(right), len(binary)) for (left, right), top in active.items())
    result = unary_union(rectangles)
    if not isinstance(result, Polygon) or not result.is_valid or result.is_empty:
        raise ValueError("A retained connected mask cannot be exported as one valid exact polygon")
    return result


def merge_weak_interfaces(labels, barrier, threshold):
    if threshold is None:
        return labels, 0
    maximum = int(labels.max())
    parent = np.arange(maximum + 1)

    def find(value):
        while parent[value] != value:
            parent[value] = parent[parent[value]]
            value = parent[value]
        return value

    codes, evidence = [], []
    for left, right, a, b in ((labels[:, :-1], labels[:, 1:], barrier[:, :-1], barrier[:, 1:]),
                             (labels[:-1], labels[1:], barrier[:-1], barrier[1:])):
        valid = (left > 0) & (right > 0) & (left != right)
        lo, hi = np.minimum(left[valid], right[valid]), np.maximum(left[valid], right[valid])
        codes.append(lo.astype(np.int64) * (maximum + 1) + hi)
        evidence.append(np.maximum(a[valid], b[valid]))
    code = np.concatenate(codes)
    values = np.concatenate(evidence)
    order = np.argsort(code, kind="stable")
    code, values = code[order], values[order]
    cuts = np.r_[0, np.flatnonzero(np.diff(code)) + 1, len(code)]
    merged = 0
    for start, stop in zip(cuts[:-1], cuts[1:]):
        if start == stop or np.quantile(values[start:stop], 0.9) >= threshold:
            continue
        left, right = divmod(int(code[start]), maximum + 1)
        a, b = find(left), find(right)
        if a != b:
            parent[max(a, b)] = min(a, b)
            merged += 1
    mapping = np.array([find(i) for i in range(maximum + 1)], dtype=np.int32)
    return mapping[labels], merged


def export_rooms(labels, probability):
    height, width = labels.shape
    rooms = []
    for ident, region in enumerate(ndimage.find_objects(labels), 1):
        if region is None:
            continue
        sy, sx = region
        binary = labels[region] == ident
        polygon = exact_cell_polygon(binary)

        def ring(coords):
            return [{"x": float((x + sx.start) / width), "y": float((y + sy.start) / height)}
                    for x, y in list(coords)[:-1]]

        points, holes = ring(polygon.exterior.coords), [ring(r.coords) for r in polygon.interiors]
        normalized = Polygon([(p["x"], p["y"]) for p in points],
                             [[(p["x"], p["y"]) for p in h] for h in holes])
        if not normalized.is_valid or not np.isclose(normalized.area * width * height, int(binary.sum())):
            raise ValueError("Normalized polygon disagrees with native pixel cells")
        rooms.append({"label": ident, "name": f"Unlabeled space {ident}",
                      "shape": {"type": "polygon", "points": points, **({"holes": holes} if holes else {})},
                      "detection": {"version": VERSION, "basis": "learned-evidence-marker-watershed",
                                    "requiresReview": True, "scoreIsCalibratedConfidence": False,
                                    "meanInteriorScore": float(probability[0][region][binary].mean())}})
    return rooms


def partition_rooms(probability, preset):
    """Only three inferred maps enter; no reference labels, counts or crops."""
    if preset not in PRESETS:
        raise ValueError("Use one of the three predeclared settings")
    p = np.asarray(probability, dtype=np.float32)
    if p.ndim != 3 or p.shape[0] != 3 or min(p.shape[1:]) < 3 or p[0].size > FIXED["maximum_pixels"]:
        raise ValueError("Expected bounded three-head probability maps")
    if not np.isfinite(p).all() or np.any((p < 0) | (p > 1)):
        raise ValueError("Probabilities must be finite and in [0, 1]")
    scale = max(p.shape[1:]) / 1024
    barrier = np.maximum(p[1], p[2])
    margin = max(1, round(FIXED["support_margin_at_1024"] * scale))
    support = ndimage.maximum_filter(p[0] >= FIXED["support"], size=margin * 2 + 1)
    domain = support & (barrier < FIXED["hard_barrier"])
    core = (p[0] >= FIXED["marker_interior"]) & (barrier < FIXED["marker_barrier"])
    distance = ndimage.distance_transform_edt(core).astype(np.float32)
    prominence = max(1, PRESETS[preset]["prominence_at_1024"] * scale)
    maxima = h_maxima(distance, prominence, footprint=ndimage.generate_binary_structure(2, 1))
    markers, count = ndimage.label(maxima & core)
    if count > FIXED["maximum_markers"]:
        raise ValueError("Marker limit exceeded; do not emit a successful partial sheet")
    if not count:
        return np.zeros(p.shape[1:], dtype=np.int32), [], {"markers": 0, "merged_interfaces": 0, "preset": preset}
    terrain = barrier + FIXED["occupancy_cost"] * (1 - p[0])
    labels = watershed(terrain, markers=markers, connectivity=1, mask=domain, compactness=0, watershed_line=False)
    labels, merged = merge_weak_interfaces(labels, barrier, PRESETS[preset]["merge_quantile90_below"])
    # A watershed label can have disconnected remnants after masks. Export each
    # retained 4-connected instance separately; never conceal an invalid shape.
    output = np.zeros(labels.shape, dtype=np.int32)
    next_label = 1
    for ident, region in enumerate(ndimage.find_objects(labels), 1):
        if region is None:
            continue
        components, n = ndimage.label(labels[region] == ident)
        area = np.bincount(components.ravel(), minlength=n + 1)
        occupancy = np.bincount(components.ravel(), weights=p[0][region].ravel(), minlength=n + 1)
        for part in range(1, n + 1):
            if area[part] >= FIXED["minimum_area"] and occupancy[part] / area[part] >= FIXED["minimum_mean_interior"]:
                output[region][components == part] = next_label
                next_label += 1
    rooms = export_rooms(output, p)
    return output, rooms, {"markers": count, "merged_interfaces": merged, "preset": preset,
                          "support_pixels": int(support.sum()), "support_margin_pixels": margin,
                          "prominence_pixels": prominence,
                          "limitations": "Inferred basins can invent partitions or merge halls; RGB/model evidence alone does not certify rooms."}
