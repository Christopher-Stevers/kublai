"""Development-only native wall/portal challenger using a learned sheet prior."""
from __future__ import annotations

import cv2
import numpy as np
from scipy import ndimage

VERSION = "context-native-wall-challenger-v2"
PRESETS = {
    "native_walls": {"gap_fraction": 0.0, "support": 0.15},
    "portal_short": {"gap_fraction": 0.005, "support": 0.15},
    "portal_medium": {"gap_fraction": 0.0095, "support": 0.15},
    "portal_wide": {"gap_fraction": 0.015, "support": 0.15},
}


def monochrome_ink(image, threshold=235, chroma=32):
    pixels = np.uint8(np.clip(image * 255, 0, 255))
    gray = pixels.astype(np.float32) @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    spread = pixels.max(axis=2).astype(np.int16) - pixels.min(axis=2).astype(np.int16)
    # This is an explicit challenger assumption, not universal color removal:
    # the existing learned barrier is retained even where native colored ink
    # is withheld. Colored structural walls require a separate domain test.
    return ((gray < threshold) & (spread <= chroma)).astype(np.uint8)


def arc_and_leaf(ink, left, right, row):
    """Require connected solid quarter-swings and leaves spanning the portal."""
    radius = right - left
    if radius < 3:
        return False
    tolerance = max(1, min(4, round(radius * 0.07)))
    components, _ = ndimage.label(ink > 0, structure=np.ones((3, 3)))
    height, width = ink.shape
    angles = np.linspace(0.08, np.pi / 2 - 0.08, 18)
    fractions = np.linspace(0.15, 0.95, 12)

    def hits(xs, ys):
        xs, ys = np.rint(xs).astype(int), np.rint(ys).astype(int)
        counts = {}
        for x, y in zip(xs, ys):
            if not (0 <= x < width and 0 <= y < height):
                continue
            ids = np.unique(components[max(0, y - tolerance):min(height, y + tolerance + 1),
                                       max(0, x - tolerance):min(width, x + tolerance + 1)])
            for ident in ids[ids > 0]:
                counts[int(ident)] = counts.get(int(ident), 0) + 1
        return {ident: count / len(xs) for ident, count in counts.items()}

    def swing(hinge, direction, side, reach):
        arc = hits(hinge + direction * reach * np.cos(angles), row + side * reach * np.sin(angles))
        leaf = hits(np.full_like(fractions, hinge), row + side * reach * fractions)
        endpoints = hits(np.array([hinge, hinge, hinge + direction * reach]),
                         np.array([row, row + side * reach, row]))
        return any(coverage >= 0.55 and leaf.get(ident, 0) >= 0.55 and endpoints.get(ident, 0) == 1
                   for ident, coverage in arc.items())

    for hinge, direction in ((left, 1), (right, -1)):
        for side in (-1, 1):
            if swing(hinge, direction, side, radius):
                return True
    # Double doors need two independently connected swing/leaf proofs whose
    # reaches meet across the opening; a half-sized door beside a wide open
    # passage is insufficient. These are fixed development hypotheses.
    for fraction in (1 / 3, 0.5, 2 / 3):
        for left_side in (-1, 1):
            if not swing(left, 1, left_side, radius * fraction):
                continue
            for right_side in (-1, 1):
                if swing(right, -1, right_side, radius * (1 - fraction)):
                    return True
    return False


def supported_portals(walls, ink, maximum):
    """Close only bounded collinear gaps with raster swing/leaf evidence."""
    result = np.zeros_like(walls)
    if maximum < 3:
        return result, 0
    closed = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, np.ones((1, maximum + 1), dtype=np.uint8))
    additions, count = ndimage.label((closed > 0) & (walls == 0))
    accepted = 0
    for ident, region in enumerate(ndimage.find_objects(additions), 1):
        if region is None:
            continue
        sy, sx = region
        gap = sx.stop - sx.start
        thickness = sy.stop - sy.start
        if gap < 3 or gap > maximum or gap < thickness * 2:
            continue
        row = (sy.start + sy.stop - 1) / 2
        # Keep the local evidence bounded, avoiding a full-image filter for
        # every candidate gap or accepting a distant furniture circle.
        margin = gap + 5
        y0, y1 = max(0, sy.start - margin), min(ink.shape[0], sy.stop + margin)
        x0, x1 = max(0, sx.start - 5), min(ink.shape[1], sx.stop + 5)
        if arc_and_leaf(ink[y0:y1, x0:x1], sx.start - x0, sx.stop - 1 - x0, row - y0):
            result[region][additions[region] == ident] = 1
            accepted += 1
    return result, accepted


def native_probabilities(image, probability, preset):
    if preset not in PRESETS:
        raise ValueError("Select a declared development preset")
    settings = PRESETS[preset]
    height, width = image.shape[:2]
    scale = max(height, width)
    ink = monochrome_ink(image)
    length = max(5, round(scale * 0.004))
    pair = max(3, round(scale * 0.002))
    if pair % 2 == 0:
        pair += 1
    # Long directional line faces reject most glyph/fixture fragments.
    horizontal = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((1, length), dtype=np.uint8))
    vertical = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((length, 1), dtype=np.uint8))
    # Fill between nearby paired faces, keeping the barrier aligned to the
    # drawn wall band instead of inventing a room-edge centerline elsewhere.
    horizontal = cv2.morphologyEx(horizontal, cv2.MORPH_CLOSE, np.ones((pair, 1), dtype=np.uint8))
    vertical = cv2.morphologyEx(vertical, cv2.MORPH_CLOSE, np.ones((1, pair), dtype=np.uint8))
    structural = ndimage.maximum_filter(probability[1], size=pair * 2 + 1) >= settings["support"]
    interior = ndimage.maximum_filter(probability[0], size=pair * 2 + 1) >= 0.5
    allowed = structural & interior
    horizontal &= allowed.astype(np.uint8)
    vertical &= allowed.astype(np.uint8)
    maximum = round(scale * settings["gap_fraction"])
    h_portals, h_count = supported_portals(horizontal, ink, maximum)
    v_portals, v_count = supported_portals(vertical.T.copy(), ink.T.copy(), maximum)
    native = (horizontal > 0) | (vertical > 0) | (h_portals > 0) | (v_portals.T > 0)
    output = probability.copy()
    # Retain the learned barrier everywhere, including diagonal/colored walls.
    output[1, native] = np.maximum(output[1, native], 0.99)
    diagnostics = {"preset": preset, "native_ink_pixels": int(ink.sum()), "native_added_barrier_pixels": int(native.sum()),
                   "newly_crossed_boundary_pixels": int(np.count_nonzero(native & (np.maximum(probability[1], probability[2]) < 0.5))),
                   "accepted_horizontal_portals": h_count, "accepted_vertical_portals": v_count,
                   "long_line_pixels": length, "paired_face_pixels": pair, "maximum_portal_pixels": maximum,
                   "assumptions": "Achromatic native long/paired lines are proposed wall evidence near learned structure/interior; raster quarter-swing+leaf required for portal closure. No completeness guarantee."}
    return output, diagnostics
