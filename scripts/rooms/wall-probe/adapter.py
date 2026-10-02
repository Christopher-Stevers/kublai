"""Pinned raw-raster CubiCasa inference adapter; no dataset or training imports."""
from __future__ import annotations

import ast
import hashlib
from pathlib import Path
import types

COMMIT = "c34440266665a11f4484eb06cd2e4b7d72ad76c1"
MODEL_SOURCE_SHA = "05a07265d9ec8cade5228b834645af00c655e1413b21d02b0b3183d041f7752a"
CHECKPOINT_SHA = "dd20b4e1bf1d670f2125107b079df06958b1ccd36e49a464ab739aeb00b8e7a2"
SOURCE_SHA = "0047f9a9c46b0a5e8770be18a7fbaefd1dd80496d3c24fa09cd233ea0a591828"
CASES = [
    ("full-sheet", [0, 0, 1, 1]),
    ("west-upper", [.105, .12, .315, .40]),
    ("west-lower", [.105, .42, .315, .70]),
    ("north-common", [.33, .10, .65, .34]),
    ("east-upper", [.665, .12, .875, .40]),
]


def digest(path):
    sha = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(chunk)
    return sha.hexdigest()


def preprocess(image):
    """RGB -> [-1,1], no contrast edit; bound to 1024 and square-pad to 256."""
    import numpy as np
    import torch
    from PIL import Image
    image = image.convert("RGB")
    width, height = image.size
    scale = min(1.0, 1024 / max(width, height))
    inner = (max(1, round(width * scale)), max(1, round(height * scale)))
    side = ((max(inner) + 255) // 256) * 256
    left, top = (side - inner[0]) // 2, (side - inner[1]) // 2
    pixels = np.array(image.resize(inner, Image.Resampling.BILINEAR), dtype=np.float32)
    content = torch.from_numpy(pixels).permute(2, 0, 1) * (2 / 255.0) - 1
    tensor = torch.zeros((3, side, side), dtype=torch.float32)
    tensor[:, top:top + inner[1], left:left + inner[0]] = content
    # Preview rounds normalized-zero padding to RGB128; tensor padding is exact 0.
    preview = Image.fromarray(np.rint((tensor.permute(1, 2, 0).numpy() + 1) * 127.5).astype(np.uint8))
    return tensor.unsqueeze(0), preview, {
        "original_size": [width, height], "resized_size": list(inner),
        "canvas_size": [side, side], "left": left, "top": top,
        "resize": "Pillow bilinear; no upscale", "normalized_padding": 0.0,
    }


def unpad(array, transform):
    width, height = transform["resized_size"]
    left, top = transform["left"], transform["top"]
    return array[..., top:top + height, left:left + width]


def model_pixel_to_page(x, y, transform, box, page_size):
    """Pixel-center coordinates on model canvas -> normalized original page."""
    width, height = transform["resized_size"]
    return (
        (box[0] + (x - transform["left"] + .5) * (box[2] - box[0]) / width) / page_size[0],
        (box[1] + (y - transform["top"] + .5) * (box[3] - box[1]) / height) / page_size[1],
    )


def page_to_model_pixel(x, y, transform, box, page_size):
    width, height = transform["resized_size"]
    return (
        (x * page_size[0] - box[0]) * width / (box[2] - box[0]) + transform["left"] - .5,
        (y * page_size[1] - box[1]) * height / (box[3] - box[1]) + transform["top"] - .5,
    )


def split_heads(prediction):
    """Official [21 heatmaps,12 rooms,11 icons]; heatmaps already sigmoid."""
    if prediction.ndim != 4 or prediction.shape[:2] != (1, 44):
        raise ValueError("Expected one 44-channel CubiCasa prediction")
    import torch
    if not torch.isfinite(prediction).all():
        raise ValueError("Non-finite model output")
    return prediction[0, :21], prediction[0, 21:33], prediction[0, 33:44]


def load_model(source_path, checkpoint_path):
    import torch
    if digest(source_path) != MODEL_SOURCE_SHA or digest(checkpoint_path) != CHECKPOINT_SHA:
        raise ValueError("Unpinned model source/checkpoint")
    tree = ast.parse(Path(source_path).read_text())
    # This dependency is used only by init_weights(), the unrelated human-pose
    # pretraining importer. Full official model_state is supplied instead.
    removed = [node for node in tree.body if isinstance(node, ast.ImportFrom)
               and node.module == "floortrans.models"
               and [alias.name for alias in node.names] == ["model_1427"]]
    if len(removed) != 1:
        raise ValueError("Unexpected upstream pretraining import")
    tree.body = [node for node in tree.body if node not in removed]
    module = types.ModuleType("pinned_cubicasa_inference")
    exec(compile(tree, str(source_path), "exec"), module.__dict__)
    model = module.hg_furukawa_original(n_classes=44)
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    state = checkpoint["model_state"]
    if not isinstance(state, dict) or not all(isinstance(v, torch.Tensor) for v in state.values()):
        raise ValueError("Expected tensor-only official model_state")
    result = model.load_state_dict(state, strict=True)
    if result.missing_keys or result.unexpected_keys:
        raise ValueError("Checkpoint architecture mismatch")
    model.eval()
    return model, {"state_keys": len(state), "strict": True, "weights_only": True,
                   "safe_globals_allowlist": [], "pose_pretraining_loaded": False,
                   "adapter": "Removed unused model_1427 import only; direct 44-class constructor; unchanged forward"}
