"""Raw source-ink diagnostics. No wall classifier, correctness probability or rejection."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from shapely.geometry import Polygon

CONFIG = {"levels": [64, 128, 192, 224, 248], "boundary_radius_px": 2,
          "interior_inset_px": 2, "achromatic_channel_spread": 16,
          "long_run_units": "native pixels and fraction of proposal bounding-box axis"}


def longest_run(mask):
    longest = 0
    for row in mask:
        changes = np.diff(np.r_[False, row, False].astype(np.int8))
        starts, ends = np.flatnonzero(changes == 1), np.flatnonzero(changes == -1)
        if len(starts):
            longest = max(longest, int(np.max(ends - starts)))
    return longest


def profile(rgb, points, holes=()):
    """Native, unmodified RGB and local pixel-center polygon coordinates required.

    Thin grids and elongated fixtures can be indistinguishable from walls here.
    Values describe ink evidence only, with no automatic pass/fail threshold.
    """
    if rgb.ndim != 3 or rgb.shape[2] != 3 or rgb.dtype != np.uint8 or rgb.size > 60_000_000:
        raise ValueError("Expected bounded native uint8 RGB")
    polygon = Polygon(points, holes)
    if not polygon.is_valid or polygon.is_empty or polygon.area <= 0:
        raise ValueError("Invalid proposal; no repair allowed")
    h, w = rgb.shape[:2]
    all_points = np.asarray([p for ring in (points, *holes) for p in ring], dtype=float)
    if not np.isfinite(all_points).all() or (all_points[:, 0] < -.5).any() or (all_points[:, 0] > w-.5).any() or (all_points[:, 1] < -.5).any() or (all_points[:, 1] > h-.5).any():
        raise ValueError("Proposal crosses the observed source crop; no silent clipping")
    # Tight computation window with a complete ink-support halo; no rescaling.
    halo = max(CONFIG["boundary_radius_px"], CONFIG["interior_inset_px"]) + 1
    x0, y0 = np.maximum(0, np.floor(all_points.min(axis=0)).astype(int)-halo)
    x1, y1 = np.minimum((w, h), np.ceil(all_points.max(axis=0)).astype(int)+halo+1)
    rgb = rgb[y0:y1, x0:x1]
    points = [(x-x0, y-y0) for x, y in points]
    holes = [[(x-x0, y-y0) for x, y in ring] for ring in holes]
    h, w = rgb.shape[:2]
    filled, boundary = Image.new("L", (w, h)), Image.new("L", (w, h))
    fill_draw, edge_draw = ImageDraw.Draw(filled), ImageDraw.Draw(boundary)
    fill_draw.polygon(points, fill=255)
    for hole in holes:
        fill_draw.polygon(hole, fill=0)
    for ring in (points, *holes):
        edge_draw.line([*ring, ring[0]], fill=255, width=1)
    interior = np.asarray(filled.filter(ImageFilter.MinFilter(2*CONFIG["interior_inset_px"]+1))) > 0
    edge = np.asarray(boundary) > 0
    gray = np.asarray(Image.fromarray(rgb).convert("L"))
    achromatic = np.ptp(rgb.astype(np.int16), axis=2) <= CONFIG["achromatic_channel_spread"]
    axis_width, axis_height = polygon.bounds[2]-polygon.bounds[0], polygon.bounds[3]-polygon.bounds[1]
    rows = []
    for level in CONFIG["levels"]:
        for name, ink in (("all", gray <= level), ("achromatic", (gray <= level) & achromatic)):
            near = np.asarray(Image.fromarray(ink.astype(np.uint8)*255).filter(
                ImageFilter.MaxFilter(2*CONFIG["boundary_radius_px"]+1))) > 0
            local = ink & interior
            horizontal, vertical = longest_run(local), longest_run(local.T)
            rows.append({"luminance_le": level, "channels": name,
                "interior_ink_fraction": float(local.sum()/interior.sum()) if interior.any() else None,
                "boundary_near_ink_fraction": float((near & edge).sum()/edge.sum()) if edge.any() else None,
                "longest_horizontal_px": horizontal, "longest_vertical_px": vertical,
                "horizontal_bbox_fraction": min(1., horizontal/axis_width),
                "vertical_bbox_fraction": min(1., vertical/axis_height)})
    return {"interior_pixels": int(interior.sum()), "boundary_pixels": int(edge.sum()),
            "bbox_width_px": axis_width, "bbox_height_px": axis_height, "profiles": rows,
            "correctness_probability": None, "wall_crossing_certified": False}
