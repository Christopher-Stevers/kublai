"""Pure, deterministic pixel-cell transforms and structured sheet nuisance ink.

No model, provisional room truth, provider API or source-file access occurs here.
Physical door targets come from the supplied source raster, never simulated gaps.
"""
from fractions import Fraction
import hashlib
import math
import random

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage, sparse

WIDTH, HEIGHT, OVERVIEW = 2048, 1536, 512
DENSITIES = ("0.4", "0.7", "1.0")
MARGIN, TITLE_X, HALO = 40, 1792, 8
REGION = (80, 80, 1728, 1440)
MAX_FIXTURES, MAX_PARKING, CLOUDS = 160, 32, 8
MAX_VOID_PARKING, VOID_MARGIN = 8, 12
EPSILON = 1e-9


def density_schedule(records):
    result = {}
    for split in ("train", "validation"):
        rows = sorted((r for r in records if r["split"] == split),
                      key=lambda r: hashlib.sha256(("domain-v1:" + r["id"]).encode()).hexdigest())
        for i, row in enumerate(rows):
            result[row["id"]] = DENSITIES[i % len(DENSITIES)]
    return result


def axis_weights(length, numerator, denominator, output_length=None):
    """Exact rational interval overlaps divided by a destination cell's width.

    Source cells have edges at integers. Integer arithmetic decides support;
    rounding cannot introduce a spurious neighbor on a rational grid boundary.
    A final partly outside cell receives zero target / white-image padding.
    """
    if min(length, numerator, denominator) < 1:
        raise ValueError("Positive rational transform required")
    count = (length * numerator + denominator - 1) // denominator
    if output_length is not None and count != output_length:
        raise ValueError("Requested axis extent disagrees with the rational transform")
    rows, cols, values = [], [], []
    for j in range(count):
        lo, hi = j * denominator, (j + 1) * denominator
        for i in range(lo // numerator, min(length, (hi + numerator - 1) // numerator)):
            overlap = min(hi, (i + 1) * numerator) - max(lo, i * numerator)
            if overlap > 0:
                rows.append(j); cols.append(i); values.append(overlap / denominator)
    return sparse.csr_matrix((values, (rows, cols)), shape=(count, length), dtype=np.float64)


def coverage(array, wy, wx):
    return np.asarray(wx @ (wy @ array.astype(np.float64)).T).T


def transform(image, target, known, density):
    if density not in DENSITIES or image.dtype != np.uint8:
        raise ValueError("Declared density and uint8 RGB required")
    if image.ndim != 3 or image.shape[2] != 3 or target.shape != known.shape or target.shape != (3, *image.shape[:2]):
        raise ValueError("Source RGB/three-head dimensions disagree")
    if not np.isin(target, (0, 1)).all() or not np.isin(known, (0, 1)).all() or np.any(target[2] > target[1]):
        raise ValueError("Binary masks and genuine opening subset required")
    ratio = Fraction(density)
    wy = axis_weights(image.shape[0], ratio.numerator, ratio.denominator)
    wx = axis_weights(image.shape[1], ratio.numerator, ratio.denominator)
    support = coverage(np.ones(image.shape[:2]), wy, wx)
    rgb = np.stack([coverage(image[:, :, i], wy, wx) + 255 * (1 - support) for i in range(3)], axis=2)
    rgb = np.uint8(np.clip(np.rint(rgb), 0, 255))
    fractions = np.stack([coverage(target[i], wy, wx) for i in range(3)])
    output = np.zeros_like(fractions, dtype=np.uint8)
    output[1:] = fractions[1:] > EPSILON
    # Preserve any physical/opening cell support, allowing at most a pixel-cell
    # raster expansion. Mixed interior cells are deliberately unsupervised.
    output[0] = (fractions[0] >= .5) & (output[1] == 0)
    supervision = np.stack([coverage(known[i] == 0, wy, wx) <= EPSILON for i in range(3)]).astype(np.uint8)
    mixed = (fractions[0] > EPSILON) & (fractions[0] < 1 - EPSILON)
    supervision[0, mixed | ((fractions[0] > EPSILON) & (output[1] > 0))] = 0
    return rgb, output, supervision


def coarse_masks(target, known, size=OVERVIEW):
    if target.shape != known.shape or target.ndim != 3 or target.shape[0] != 3:
        raise ValueError("Three-head page masks required")
    h, w = target.shape[1:]
    wy, wx = axis_weights(h, size, h, size), axis_weights(w, size, w, size)
    frac = np.stack([coverage(target[i], wy, wx) for i in range(3)])
    result = np.zeros_like(frac, dtype=np.uint8)
    result[0] = frac[0] >= .5
    result[1:] = frac[1:] > EPSILON
    mask = np.stack([coverage(known[i] == 0, wy, wx) <= EPSILON for i in range(3)]).astype(np.uint8)
    mask[0, (frac[0] > EPSILON) & (frac[0] < 1 - EPSILON)] = 0
    return result, mask


def structure_crop(image, target, known):
    """Keep every physical/interior/unknown pixel; discard source title/frame ink.

    Source v4 has a fixed image coordinate frame. Tight target/unknown bounds
    with an eight-pixel halo cannot include its title block or sheet frame.
    Door-swing ink beyond this halo is not guaranteed; actual footprints are.
    """
    if image.shape != (HEIGHT, WIDTH, 3) or target.shape != (3, HEIGHT, WIDTH) or known.shape != target.shape:
        raise ValueError("Only fixed native v4 page dimensions are accepted")
    support = np.any(target > 0, axis=0) | np.any(known == 0, axis=0)
    ys, xs = np.where(support)
    if not len(xs):
        raise ValueError("Empty source structure")
    left, top = max(0, int(xs.min()) - HALO), max(0, int(ys.min()) - HALO)
    right, bottom = min(WIDTH, int(xs.max()) + 1 + HALO), min(HEIGHT, int(ys.max()) + 1 + HALO)
    # The original title divider is x1792 and frame is x/y41/31. Its top
    # section bubbles are below y60, outside the legal floor structure crop.
    if left <= MARGIN or top <= 64 or right >= TITLE_X or bottom >= HEIGHT - MARGIN:
        raise ValueError("Source support/halo intersects source sheet annotations")
    outside = support.copy(); outside[top:bottom, left:right] = False
    if outside.any():
        raise ValueError("Crop discards source physical/interior/unknown support")
    return image[top:bottom, left:right].copy(), target[:, top:bottom, left:right].copy(), known[:, top:bottom, left:right].copy(), (left, top, right, bottom)


def _safe_box(mask, box):
    x0, y0, x1, y1 = box
    return 0 <= x0 <= x1 < mask.shape[1] and 0 <= y0 <= y1 < mask.shape[0] and mask[y0:y1 + 1, x0:x1 + 1].all()


def nuisance(image, target, known, box, seed):
    """Image-only clutter with bounded, context-constrained placements."""
    rng = random.Random(seed)
    draw = ImageDraw.Draw(image)
    draw.rectangle((MARGIN, MARGIN, WIDTH - MARGIN, HEIGHT - MARGIN), outline=(70, 70, 70), width=1)
    draw.line((TITLE_X, MARGIN, TITLE_X, HEIGHT - MARGIN), fill=(45, 45, 45), width=1)
    for y in np.linspace(MARGIN, HEIGHT - MARGIN, 18).astype(int):
        draw.line((TITLE_X, int(y), WIDTH - MARGIN, int(y)), fill=(65, 65, 65), width=1)
        draw.text((TITLE_X + 8, int(y) + 5), "PLAN REV DIM", fill=(50, 50, 50))
    # Dimension/grid ink may cross genuine geometry without changing a label.
    for x in np.linspace(MARGIN + 32, TITLE_X - 32, 24).astype(int):
        draw.ellipse((int(x) - 6, 50, int(x) + 6, 62), outline=(80, 80, 80), width=1)
        for y in range(64, HEIGHT - MARGIN, 22):
            draw.line((int(x), y, int(x), y + 9), fill=(180, 180, 180), width=1)
    negatives = np.all(known > 0, axis=0) & ~np.any(target > 0, axis=0)
    left, top, right, bottom = box
    # Existing head-negative pockets may contain open court/void-like space.
    # We do not infer a new semantic label or claim these are genuine parking.
    # A full margin from positive AND unknown pixels protects physical targets.
    void_safe = ndimage.distance_transform_edt(negatives) > VOID_MARGIN
    void_safe[:top] = False; void_safe[bottom:] = False
    void_safe[:, :left] = False; void_safe[:, right:] = False
    void_boxes = []
    for _ in range(MAX_VOID_PARKING * 80):
        if len(void_boxes) >= MAX_VOID_PARKING:
            break
        x, y = rng.randrange(left, right), rng.randrange(top, bottom)
        w, h = rng.randrange(28, 64), rng.randrange(30, 64)
        b = (x, y, x + w, y + h)
        if not _safe_box(void_safe, b):
            continue
        draw.rectangle(b, outline=(110, 110, 110), width=1)
        for xx in range(x + 8, x + w, 12):
            draw.line((xx, y, xx, y + h), fill=(150, 150, 150), width=1)
        void_boxes.append(list(b)); void_safe[y:y + h + 1, x:x + w + 1] = False
    safe = negatives.copy()
    safe[top:bottom, left:right] = False
    safe[:, TITLE_X - 8:] = False
    parking = list(void_boxes)
    for _ in range(MAX_PARKING * 20):
        if len(parking) >= MAX_PARKING:
            break
        x, y = rng.randrange(MARGIN + 10, TITLE_X - 100), rng.randrange(80, HEIGHT - MARGIN - 80)
        w, h = rng.randrange(28, 82), rng.randrange(30, 72)
        b = (x, y, x + w, y + h)
        if not _safe_box(safe, b):
            continue
        draw.rectangle(b, outline=(110, 110, 110), width=1)
        for xx in range(x + 8, x + w, 12):
            draw.line((xx, y, xx, y + h), fill=(150, 150, 150), width=1)
        if len(parking) % 3 == 0:
            draw.ellipse((x + 2, y + 2, x + w - 2, y + h - 2), outline=(100, 120, 100), width=1)
        parking.append(list(b)); safe[y:y + h + 1, x:x + w + 1] = False
    indoor = (target[0] > 0) & (known[0] > 0) & (target[1] == 0)
    anchors = np.flatnonzero(indoor)
    fixtures = []
    for _ in range(MAX_FIXTURES * 10):
        if len(fixtures) >= MAX_FIXTURES or not len(anchors):
            break
        y, x = divmod(int(anchors[rng.randrange(len(anchors))]), WIDTH)
        w, h = rng.randrange(5, 42), rng.randrange(5, 28)
        b = (x - w // 2, y - h // 2, x + w // 2, y + h // 2)
        if not _safe_box(indoor, b):
            continue
        color, shape = rng.choice([30, 70, 110, 150]), rng.choice(["rectangle", "ellipse"])
        getattr(draw, shape)(b, outline=(color,) * 3, width=1)
        if len(fixtures) % 3 == 0:
            for yy in range(b[1] + 3, b[3], 4):
                draw.line((b[0], yy, b[2], yy), fill=(color,) * 3, width=1)
        fixtures.append({"box": list(b), "shape": shape, "gray": color})
        indoor[b[1]:b[3] + 1, b[0]:b[2] + 1] = False
    clouds = []
    for i in range(CLOUDS):
        if i < CLOUDS // 2:
            # Half the clouds overlap the floor's vicinity; targets are never
            # inferred from cloud placement or silently converted to negatives.
            cx, cy = rng.randrange(left, right), rng.randrange(top, bottom)
        else:
            cx, cy = rng.randrange(120, TITLE_X - 120), rng.randrange(140, HEIGHT - 140)
        rx, ry = rng.randrange(45, 145), rng.randrange(35, 95)
        pts = []
        for step in range(145):
            a = step * math.pi / 72; r = 1 + .10 * math.cos(16 * a)
            pts.append((cx + rx * r * math.cos(a), cy + ry * r * math.sin(a)))
        color = [(190, 35, 30), (155, 45, 85), (130, 130, 130)][i % 3]
        draw.line(pts, fill=color, width=1 + i % 2)
        clouds.append({"center": [cx, cy], "radii": [rx, ry], "rgb": color})
    return {"parking_landscape": parking, "fixtures": fixtures, "clouds": clouds,
            "known_negative_pocket_motifs": void_boxes, "negative_pocket_margin": VOID_MARGIN,
            "maximum_fixture_count": MAX_FIXTURES, "maximum_parking_count": MAX_PARKING,
            "nonstructural_ink_changes_targets": False}


def page(image, target, known, density, seed):
    crop, local, supervision, bounds = structure_crop(image, target, known)
    rgb, local, supervision = transform(crop, local, supervision, density)
    h, w = rgb.shape[:2]
    minx, miny, maxx, maxy = REGION
    if w > maxx - minx or h > maxy - miny:
        raise ValueError("Declared uniform density would clip structure; do not silently fit or crop")
    rng = random.Random(seed)
    x, y = rng.randrange(minx, maxx - w + 1), rng.randrange(miny, maxy - h + 1)
    output = Image.new("RGB", (WIDTH, HEIGHT), "white")
    output.paste(Image.fromarray(rgb), (x, y))
    expected = np.zeros((3, HEIGHT, WIDTH), dtype=np.uint8)
    mask = np.ones_like(expected)
    expected[:, y:y + h, x:x + w] = local
    mask[:, y:y + h, x:x + w] = supervision
    before = hashlib.sha256(expected.tobytes() + mask.tobytes()).hexdigest()
    expected.flags.writeable = mask.flags.writeable = False
    ink = nuisance(output, expected, mask, (x, y, x + w, y + h), seed + 1)
    if before != hashlib.sha256(expected.tobytes() + mask.tobytes()).hexdigest():
        raise ValueError("Nonstructural augmentation changed physical supervision")
    coarse, coarse_known = coarse_masks(expected, mask)
    rgb = np.asarray(output).copy()
    luma = rgb.astype(np.float32) @ np.array([.2126, .7152, .0722], dtype=np.float32)
    stats = {"native_width": WIDTH, "native_height": HEIGHT, "source_crop_pixels": list(bounds),
             "density": density, "destination_origin": [x, y], "destination_extent": [w, h],
             "uniform_affine_source_pixel_to_destination": [[float(density), 0, x - float(density) * bounds[0]],
                                                            [0, float(density), y - float(density) * bounds[1]]],
             "physical_opening_pixels": int(expected[2].sum()),
             "unknown_positive_opening_pixels": int(np.count_nonzero((expected[2] > 0) & (mask[2] == 0))),
             "unknown_pixels_per_head": [int(np.count_nonzero(k == 0)) for k in mask],
             "chromatic_pixels": int(np.count_nonzero(np.ptp(rgb.astype(np.int16), axis=2) > 20)),
             "ink_pixels": int(np.count_nonzero(luma < 245)), **ink,
             "real_door_coordinates": True, "physical_room_ground_truth_certified": False,
             "all_space_scoring_eligible": False, "human_completeness_evidence": False,
             "approved_for_production": False}
    return output, expected, mask, coarse, coarse_known, stats
