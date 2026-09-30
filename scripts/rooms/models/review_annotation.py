"""Audit dense physical-room annotations before instance rasterization."""
from __future__ import annotations

from shapely.affinity import scale
from shapely.strtree import STRtree

BOUNDARY_TOLERANCE_PIXELS = 1.0


def significant_room_overlaps(rooms, width, height):
    """Return conflicting instances; permit one native pixel per boundary.

    rooms is a list of (stable room id, normalized Shapely Polygon). A corridor
    hole remains a hole. Close duplicates are rejected even if a tiny shape
    has no interior left after erosion. The audit is not a completeness proof.
    """
    if width < 1 or height < 1:
        raise ValueError("Native annotation dimensions must be positive")
    polygons = [scale(polygon, xfact=width, yfact=height, origin=(0, 0)) for _, polygon in rooms]
    if any(not polygon.is_valid or polygon.is_empty or polygon.area <= 0 for polygon in polygons):
        raise ValueError("Dense room annotations must have valid positive-area geometry")
    tree = STRtree(polygons)
    trimmed = [polygon.buffer(-BOUNDARY_TOLERANCE_PIXELS) for polygon in polygons]
    errors = []
    for i, polygon in enumerate(polygons):
        for j in tree.query(polygon):
            j = int(j)
            if j <= i:
                continue
            intersection = polygon.intersection(polygons[j]).area
            duplicate = intersection / min(polygon.area, polygons[j].area) >= 0.95
            interior_overlap = trimmed[i].intersection(trimmed[j]).area
            if duplicate or interior_overlap > 1e-6:
                errors.append({"left_room_id": rooms[i][0], "right_room_id": rooms[j][0],
                               "overlap_native_square_pixels": float(intersection),
                               "reason": "near_duplicate_or_nested" if duplicate else "interior_overlap"})
    return errors
