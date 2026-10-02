"""Inference-only loading of pinned upstream Raster2Seq, never training or scoring."""
from __future__ import annotations

import argparse
import ast
import hashlib
import importlib
import re
import sys
import types
from pathlib import Path

UPSTREAM_COMMIT = "031f565c4d5d08fc889bbcd873d4afb62dce3676"
CHECKPOINT_SHA = "f7c0ef9379aa8cf11349da8b2179214e0d495af758383984a2361a1309aab3b7"
SOURCE_SHA = "0047f9a9c46b0a5e8770be18a7fbaefd1dd80496d3c24fa09cd233ea0a591828"


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(4 * 1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def extract_definitions(path: Path, names: set[str], globals_: dict):
    """Execute only exact named upstream definitions, not dataset/evaluation imports."""
    tree = ast.parse(path.read_text())
    body = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name in names]
    if {n.name for n in body} != names:
        raise ValueError("missing upstream definitions")
    exec(compile(ast.Module(body=body, type_ignores=[]), str(path), "exec"), globals_)
    return globals_


def blocked_training(*args, **kwargs):
    raise RuntimeError("training/loss code is unavailable in this inference-only adapter")


def checkpoint_state(state):
    """Discard only saved transient inference caches and profiler counters.

    Upstream predict.py ignores unexpected keys; this narrower adapter keeps
    strict architecture loading for every parameter/persistent backbone buffer.
    Caches are re-created by official forward_inference._setup_caches each view.
    """
    clean, ignored = {}, []
    for key, value in state.items():
        key = key.removeprefix("module.")
        cache = re.fullmatch(r"transformer\.decoder\.layers\.[0-5]\.(?:kv_cache\.[kv]_cache|cross_attn\.cache\.v_cache)", key)
        if cache or key.endswith(("total_ops", "total_params")):
            ignored.append(key)
        else:
            clean[key] = value
    return clean, ignored


def safe_checkpoint(checkpoint: Path):
    """Digest-pin the official checkpoint and allow only its known Namespace.

    Static pickle inspection cannot make arbitrary files trustworthy. The exact
    official digest is required in addition to weights_only and this narrow class
    allowlist; no unrestricted unpickle fallback is available.
    """
    import torch

    if digest(checkpoint) != CHECKPOINT_SHA:
        raise ValueError("unverified checkpoint")
    unsafe = torch.serialization.get_unsafe_globals_in_checkpoint(checkpoint)
    if set(unsafe) - {"argparse.Namespace"}:
        raise ValueError("undeclared checkpoint globals")
    with torch.serialization.safe_globals([argparse.Namespace]):
        loaded = torch.load(checkpoint, map_location="cpu", weights_only=True)
    if digest(checkpoint) != CHECKPOINT_SHA:
        raise ValueError("checkpoint changed during safe loading")
    return loaded


def import_upstream(root: Path):
    """Keep architecture/weights intact; substitute only unused imports and MSDA backend.

    The original compiled MSDA function is backed by its own unmodified PyTorch
    reference. This is an explicitly different runtime, not a CUDA-kernel benchmark.
    Package shells avoid importing training/dataset/evaluation entrypoints. TokenType
    and official generation/postprocessing are extracted verbatim through Python AST.
    """
    import numpy as np
    import torch
    import torchvision
    from enum import Enum
    from shapely.geometry import Polygon

    for name in ("models", "datasets", "util"):
        if name in sys.modules:
            raise RuntimeError("upstream namespace already imported")
        module = types.ModuleType(name)
        module.__path__ = [str(root / name)]
        sys.modules[name] = module
    token_module = types.ModuleType("datasets.poly_data")
    token_module.__dict__.update(extract_definitions(root / "datasets/poly_data.py", {"TokenType"}, {"Enum": Enum, "__name__": token_module.__name__}))
    sys.modules[token_module.__name__] = token_module
    loss_module = types.ModuleType("models.losses")
    loss_module.MaskRasterizationLoss = blocked_training
    sys.modules[loss_module.__name__] = loss_module
    extension = types.ModuleType("MultiScaleDeformableAttention")

    def attention(value, shapes, starts, locations, weights, step):
        reference = importlib.import_module("models.ops.functions.ms_deform_attn_func")
        return reference.ms_deform_attn_core_pytorch(value, shapes, locations, weights)

    extension.ms_deform_attn_forward = attention
    extension.ms_deform_attn_backward = blocked_training
    sys.modules[extension.__name__] = extension
    tokenizer_class = importlib.import_module("datasets.discrete_tokenizer").DiscreteTokenizer
    architecture = importlib.import_module("models.raster2seq")
    decode = extract_definitions(root / "engine.py", {"_process_predictions", "generate"}, {"np": np, "torch": torch, "Polygon": Polygon})
    parser = extract_definitions(root / "predict.py", {"get_args_parser"}, {"argparse": argparse, "np": np})["get_args_parser"]()

    # The complete checkpoint supplies every backbone weight. Avoid a second
    # ImageNet download and reject any missing state-dict key below.
    resnet50 = torchvision.models.resnet50

    def no_download_resnet50(*args, **kwargs):
        kwargs.pop("pretrained", None)
        kwargs["weights"] = None
        return resnet50(*args, **kwargs)

    torchvision.models.resnet50 = no_download_resnet50
    return architecture, tokenizer_class, decode, parser


def load_model(root: Path, checkpoint: Path, config: dict):
    import torch

    architecture, tokenizer_class, decode, parser = import_upstream(root)
    args = parser.parse_args([])
    for key, value in config["inference_args"].items():
        if not hasattr(args, key):
            raise ValueError("unexpected upstream config key: " + key)
        setattr(args, key, value)
    if args.disable_poly_refine:
        args.with_poly_refine = False
    args.image_size = 256
    tokenizer = tokenizer_class(args.num_bins, args.seq_len, add_cls=args.add_cls_token)
    args.vocab_size = len(tokenizer)
    model = architecture.build(args, train=False, tokenizer=tokenizer)
    if digest(checkpoint) != CHECKPOINT_SHA:
        raise ValueError("unverified checkpoint")
    ckpt = safe_checkpoint(checkpoint)
    state = ckpt["ema"] if args.ema4eval else ckpt["model"]
    state, ignored = checkpoint_state(state)
    model.load_state_dict(state, strict=True)
    model.adapter_ignored_checkpoint_keys = ignored
    if digest(checkpoint) != CHECKPOINT_SHA:
        raise ValueError("checkpoint changed during loading")
    del state, ckpt
    model.eval().requires_grad_(False).to("cuda")
    return model, decode["generate"], args


def resize_metadata(width: int, height: int, size: int = 256) -> dict:
    if min(width, height, size) <= 0:
        raise ValueError("invalid dimensions")
    scale = min(size / height, size / width)
    new_h, new_w = int(height * scale), int(width * scale)
    if min(new_h, new_w) < 1:
        raise ValueError("degenerate resizing")
    return {"width": width, "height": height, "size": size, "new_width": new_w, "new_height": new_h, "left": (size - new_w) // 2, "top": (size - new_h) // 2}


def unpad_point(point, transform: dict, box, page_size):
    """Invert PIL resize's pixel-center frame, preserving out-of-crop proposals."""
    x = ((float(point[0]) - transform["left"] + .5) * transform["width"] / transform["new_width"] - .5 + box[0]) / page_size[0]
    y = ((float(point[1]) - transform["top"] + .5) * transform["height"] / transform["new_height"] - .5 + box[1]) / page_size[1]
    return [x, y]


def preprocess(image):
    import numpy as np
    import torch
    from PIL import Image

    meta = resize_metadata(*image.size)
    resized = image.convert("RGB").resize((meta["new_width"], meta["new_height"]), Image.Resampling.BICUBIC)
    padded = Image.new("RGB", (256, 256), "white")
    padded.paste(resized, (meta["left"], meta["top"]))
    # Same 0..1 RGB normalization as official ImageDataset, no ImageNet transform.
    tensor = torch.as_tensor(np.asarray(padded).copy().transpose(2, 0, 1)) / 255
    return tensor.float().unsqueeze(0).to("cuda"), padded, meta
