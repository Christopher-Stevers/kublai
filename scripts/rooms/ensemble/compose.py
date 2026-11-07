"""The single declared ensemble: old interior, new boundary and opening."""
from __future__ import annotations

import numpy as np

MAX_PIXELS = 30_000_000


def validate_probability(value):
    if not isinstance(value, np.ndarray) or value.dtype != np.dtype("float32"):
        raise ValueError("Prediction caches must contain float32 arrays")
    if value.ndim != 3 or value.shape[0] != 3 or min(value.shape[1:]) < 1:
        raise ValueError("Exactly three nonempty native probability heads are required")
    if value.shape[1] * value.shape[2] > MAX_PIXELS:
        raise ValueError("Native prediction exceeds the declared page budget")
    if not np.isfinite(value).all() or value.min() < 0 or value.max() > 1:
        raise ValueError("Every probability must be finite and in [0, 1]")


def compose_probability(old, new):
    """Copy selected heads exactly, without weights, clipping or input mutation."""
    validate_probability(old)
    validate_probability(new)
    if old.shape != new.shape:
        raise ValueError("Both models must predict the identical native pixel grid")
    result = old.copy(order="C")
    result[1:] = new[1:]
    return result
