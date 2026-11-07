"""Declared offline bounded-occupancy flood-fill and scale-aware area hypotheses."""
from __future__ import annotations

import numpy as np
from scipy import ndimage

from predict import global_rooms

VERSION = "context-bounded-roi-challenger-v1"
PRESETS = {
    "baseline": {"boundary": 0.5, "support": None, "margin_fraction": 0.0, "scale_area": False, "core_area": 0},
    "baseline_low_barrier": {"boundary": 0.4, "support": None, "margin_fraction": 0.0, "scale_area": False, "core_area": 0},
    "bounded_roi": {"boundary": 0.5, "support": 0.15, "margin_fraction": 0.003, "scale_area": False, "core_area": 0},
    "bounded_low_barrier": {"boundary": 0.4, "support": 0.15, "margin_fraction": 0.003, "scale_area": False, "core_area": 0},
    "bounded_scaled_area": {"boundary": 0.5, "support": 0.15, "margin_fraction": 0.003, "scale_area": True, "core_area": 0},
    "bounded_scaled_core": {"boundary": 0.5, "support": 0.15, "margin_fraction": 0.003, "scale_area": True, "core_area": 9},
}


def bounded_rooms(probability, preset):
    """Bound flood-fill by occupancy support; no absent wall evidence is supplied.

    Filling support holes before clipping avoids an unsupported interior island
    becoming a synthetic room boundary. Courtyards then remain governed by the
    native wall graph and the mean interior-score gate. Open support slits are
    still a domain limitation and must be checked against emitted polygons.
    """
    if preset not in PRESETS:
        raise ValueError("Use a fixed declared development preset")
    probability = np.asarray(probability)
    if probability.ndim != 3 or probability.shape[0] != 3 or not np.isfinite(probability).all():
        raise ValueError("Expected three finite probability maps")
    if np.any((probability < 0) | (probability > 1)):
        raise ValueError("Probabilities must lie in [0, 1]")
    settings = PRESETS[preset]
    scale = max(probability.shape[1:])
    scale_squared = (scale / 1024) ** 2
    area = max(25, round(25 * scale_squared)) if settings["scale_area"] else 25
    core_area = round(settings["core_area"] * max(1, scale_squared))
    adapted = probability.copy()
    support = np.ones(probability.shape[1:], dtype=bool)
    margin = 0
    if settings["support"] is not None:
        margin = max(1, round(scale * settings["margin_fraction"]))
        support = ndimage.maximum_filter(probability[0] >= settings["support"], size=margin * 2 + 1)
        support = ndimage.binary_fill_holes(support)
        adapted[1, ~support] = 1.0
        adapted[0, ~support] = 0.0
    labels, rooms = global_rooms(adapted, boundary_threshold=settings["boundary"], min_area=area)
    removed = 0
    if core_area:
        core = np.bincount(labels.ravel(), weights=(probability[0] >= 0.7).ravel(), minlength=len(rooms) + 1)
        mapping = np.zeros(len(rooms) + 1, dtype=np.int32)
        retained = []
        for room in rooms:
            ident = room["label"]
            if core[ident] < core_area:
                removed += 1
                continue
            mapping[ident] = len(retained) + 1
            room["label"] = len(retained) + 1
            room["name"] = f"Unlabeled space {room['label']}"
            retained.append(room)
        labels, rooms = mapping[labels], retained
    for room in rooms:
        room["detection"].update(version=VERSION, basis="bounded-learned-interior-flood-fill")
    diagnostics = {"preset": preset, "support_pixels": int(support.sum()), "margin_pixels": margin,
                   "minimum_area_pixels": area, "minimum_core_pixels": core_area,
                   "core_removed_rooms": removed,
                   "limitations": "Learned exterior support may create artificial boundaries at open support slits; missing internal walls remain missing. Scores are not calibrated."}
    return labels, rooms, diagnostics
