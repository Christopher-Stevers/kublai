"""Bounded official SAM 2.1 tiny image inference; never downloads at runtime."""
from __future__ import annotations

import contextlib
import importlib.metadata
import platform
import subprocess
import time
from pathlib import Path

import numpy as np
import torch
import sam2
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor

from common import SAM_COMMIT, TINY_SHA256, file_hash, select_mask, validate_points


class LocalSAM:
    def __init__(self, checkpoint: Path, device: str = "cuda", gpu_fraction: float = .2):
        if file_hash(checkpoint) != TINY_SHA256:
            raise ValueError("Checkpoint does not match the tested official SAM 2.1 tiny weights")
        official_repo = Path(sam2.__file__).resolve().parent.parent
        commit = subprocess.check_output(["git", "-C", str(official_repo), "rev-parse", "HEAD"], text=True).strip()
        dirty = subprocess.check_output(["git", "-C", str(official_repo), "status", "--porcelain", "--untracked-files=no"], text=True).strip()
        if commit != SAM_COMMIT or dirty:
            raise ValueError("Official SAM source must match the frozen, clean tested checkout")
        torch.set_num_threads(4)
        self.device = device
        if device == "cuda":
            if not .05 <= gpu_fraction <= .25:
                raise ValueError("GPU fraction must be between 0.05 and 0.25")
            torch.cuda.set_per_process_memory_fraction(gpu_fraction)
        self.predictor = SAM2ImagePredictor(build_sam2(
            "configs/sam2.1/sam2.1_hiera_t.yaml", str(checkpoint), device=device,
            apply_postprocessing=False), max_hole_area=0, max_sprinkle_area=0)
        self.shape = None
        self.runtime = {"python": platform.python_version(),
                        **{name: importlib.metadata.version(name) for name in
                           ("torch", "torchvision", "numpy", "pillow", "scipy", "shapely")},
                        "device": torch.cuda.get_device_name() if device == "cuda" else "cpu",
                        "precision": "bfloat16 autocast" if device == "cuda" else "float32"}

    def precision(self):
        return (torch.autocast("cuda", dtype=torch.bfloat16) if self.device == "cuda"
                else contextlib.nullcontext())

    def synchronize(self):
        if self.device == "cuda":
            torch.cuda.synchronize()

    def set_image(self, image: np.ndarray) -> float:
        h, w = image.shape[:2]
        if image.ndim != 3 or image.shape[2] != 3 or image.dtype != np.uint8 or h * w > 30_000_000:
            raise ValueError("Expected RGB uint8 image of at most 30 megapixels")
        self.synchronize(); start = time.monotonic()
        with torch.inference_mode(), self.precision():
            self.predictor.set_image(np.array(image, copy=True))
        self.synchronize(); self.shape = (h, w)
        return (time.monotonic() - start) * 1000

    def predict(self, taps: list, box=None, mask_input=None):
        if self.shape is None:
            raise ValueError("Set an image first")
        h, w = self.shape
        points, labels = validate_points(taps, w, h)
        if box is not None:
            box = np.asarray(box, dtype=np.float32)
            if (box.shape != (4,) or not np.isfinite(box).all() or
                not (0 <= box[0] < box[2] <= w and 0 <= box[1] < box[3] <= h)):
                raise ValueError("Invalid selection box")
        self.synchronize(); start = time.monotonic()
        with torch.inference_mode(), self.precision():
            masks, scores, logits = self.predictor.predict(
                point_coords=points, point_labels=labels, box=box,
                mask_input=mask_input, multimask_output=True)
        self.synchronize()
        selected = select_mask(masks.astype(bool), scores, points, labels)
        return {"mask": masks[selected].astype(bool), "score": float(scores[selected]),
                "masks": masks.astype(bool), "scores": scores, "selected": selected,
                "logits": logits[selected][None],
                "decoder_ms": (time.monotonic() - start) * 1000}

    def peak_gpu_mib(self) -> float | None:
        return torch.cuda.max_memory_allocated() / 2 ** 20 if self.device == "cuda" else None
