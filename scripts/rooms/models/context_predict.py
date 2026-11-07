"""Unapproved native-resolution inference conditioned on the whole RGB page."""
from __future__ import annotations

import argparse
from importlib.metadata import version
import json
import os
from pathlib import Path
import sys
import time

import numpy as np
from PIL import Image
import torch
from torch.nn import functional as F

from common import HEADS, file_hash, private_dir, source_hashes, write_json
from context_network import ContextUNet, VERSION
from predict import global_rooms, starts


def runtime_versions():
    return {"python": sys.version.split()[0], "torch": torch.__version__, "cuda": torch.version.cuda,
            **{name: version(package) for name, package in
               (("numpy", "numpy"), ("pillow", "pillow"), ("opencv", "opencv-python-headless"),
                ("scipy", "scipy"), ("shapely", "shapely"))}}


def verify_hashes(frozen):
    """A report must identify exactly the bytes decoded and loaded for this run."""
    for path, expected in frozen.items():
        if file_hash(path) != expected:
            raise RuntimeError(f"Frozen input changed during the run: {path.name}; discard this result")


def load_context_model(checkpoint, device):
    saved = torch.load(checkpoint, map_location="cpu", weights_only=True)
    metadata = json.loads(saved["metadata_json"])
    if metadata.get("version") != VERSION or metadata.get("heads") != list(HEADS):
        raise ValueError("Unsupported context checkpoint contract")
    current = source_hashes()
    for name in ("common.py", "network.py", "context_network.py"):
        if metadata["source_hashes"].get(name) != current[name]:
            raise ValueError("Context architecture source changed; start an explicitly new version")
    model = ContextUNet(metadata["base"], metadata["context_base"])
    model.load_state_dict(saved["weights"], strict=True)
    return model.to(device).eval(), metadata


def context_probabilities(model, image, tile, overlap, overview_size, device):
    height, width = image.shape[:2]
    # Overview is computed once per page, not once per tile.
    small = np.asarray(Image.fromarray(np.uint8(np.clip(image * 255, 0, 255))).resize(
        (overview_size, overview_size), Image.Resampling.LANCZOS), dtype=np.float32) / 255
    tensor = torch.from_numpy(small.transpose(2, 0, 1).copy()).unsqueeze(0).to(device)
    sums = np.zeros((len(HEADS), height, width), dtype=np.float32)
    weights = np.zeros((height, width), dtype=np.float32)
    blend = np.maximum(0.05, np.outer(np.hanning(tile), np.hanning(tile))).astype(np.float32)
    with torch.inference_mode():
        with torch.autocast("cuda", dtype=torch.bfloat16) if device.type == "cuda" else torch.autocast("cpu", enabled=False):
            coarse = model.overview(tensor)
        global_interior = F.interpolate(coarse[:, :1].float().sigmoid(), size=(height, width),
                                        mode="bilinear", align_corners=False).cpu().numpy()[0, 0]
        for y in starts(height, tile, overlap):
            for x in starts(width, tile, overlap):
                h, w = min(tile, height - y), min(tile, width - x)
                pixels = np.ones((tile, tile, 3), dtype=np.float32)
                pixels[:h, :w] = image[y:y + h, x:x + w]
                local = torch.from_numpy(pixels.transpose(2, 0, 1).copy()).unsqueeze(0).to(device)
                boxes = torch.tensor([[x / width, y / height, (x + tile) / width, (y + tile) / height]], device=device)
                with torch.autocast("cuda", dtype=torch.bfloat16) if device.type == "cuda" else torch.autocast("cpu", enabled=False):
                    probability = model.local_logits(local, coarse, boxes).float().sigmoid().cpu().numpy()[0, :, :h, :w]
                sums[:, y:y + h, x:x + w] += probability * blend[:h, :w]
                weights[y:y + h, x:x + w] += blend[:h, :w]
    probability = sums / weights[None]
    # Conservative page-scale occupancy cue; barriers retain local resolution.
    # This fixed fusion is declared before evaluation, not tuned on a holdout.
    probability[0] = (probability[0] + global_interior) * 0.5
    return probability, global_interior


def run(args):
    sources = source_hashes()
    frozen = {args.image: file_hash(args.image), args.checkpoint: file_hash(args.checkpoint)}
    torch.set_num_threads(args.threads)
    device = torch.device(args.device)
    if device.type == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable")
    with Image.open(args.image) as source:
        if source.width * source.height > 30_000_000:
            raise ValueError("Input exceeds the bounded 30-megapixel local adapter")
        image = np.asarray(source.convert("RGB"), dtype=np.float32) / 255
    verify_hashes(frozen)
    model, metadata = load_context_model(args.checkpoint, device)
    verify_hashes(frozen)
    private_dir(args.output)
    started = time.monotonic()
    if device.type == "cuda":
        torch.cuda.reset_peak_memory_stats(device)
    probability, overview = context_probabilities(model, image, metadata["tile"], args.overlap,
                                                  metadata["overview"], device)
    labels, rooms = global_rooms(probability, args.boundary_threshold, args.interior_threshold, args.min_area)
    for room in rooms:
        room["detection"].update(version=VERSION, basis="local-context-structural-model")
    labels.astype("<i4").tofile(args.output / "labels.i32")
    np.savez_compressed(args.output / "probabilities.npz", probability=probability, overview_interior=overview)
    verify_hashes(frozen)
    if source_hashes() != sources:
        raise RuntimeError("Inference source changed during the run; discard this result")
    result = {"version": VERSION, "width": image.shape[1], "height": image.shape[0], "rooms": rooms,
              "input_sha256": frozen[args.image], "checkpoint_sha256": frozen[args.checkpoint],
              "training_manifest_sha256": metadata["manifest_sha256"], "source_hashes": sources,
              "runtime": {**runtime_versions(), "device": torch.cuda.get_device_name(device) if device.type == "cuda" else "CPU"},
              "tiling": {"tile": metadata["tile"], "overlap": args.overlap, "overview": metadata["overview"]},
              "thresholds": {"boundary": args.boundary_threshold, "interior": args.interior_threshold, "minArea": args.min_area},
              "interior_fusion": "Mean of native local interior probability and aligned whole-page overview probability.",
              "wall_seconds": time.monotonic() - started,
              "peak_cuda_allocated_mib": torch.cuda.max_memory_allocated(device) / 2 ** 20 if device.type == "cuda" else 0,
              "approved_for_production": False,
              "limitations": "Unapproved procedural whole-sheet challenger. Scores are not calibrated confidence; actual room recall requires complete reviewed real floors."}
    write_json(args.output / "prediction.json", result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True); parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True); parser.add_argument("--device", choices=["cuda", "cpu"], default="cuda")
    parser.add_argument("--overlap", type=int, default=128); parser.add_argument("--boundary-threshold", type=float, default=0.5)
    parser.add_argument("--interior-threshold", type=float, default=0.35); parser.add_argument("--min-area", type=int, default=25)
    parser.add_argument("--threads", type=int, default=4); args = parser.parse_args()
    if not 0 < args.boundary_threshold < 1 or not 0 <= args.interior_threshold <= 1 or args.min_area < 1 or args.threads < 1:
        parser.error("Valid thresholds and positive resource limits are required")
    os.umask(0o077); result = run(args)
    print(json.dumps({"rooms": len(result["rooms"]), "wall_seconds": result["wall_seconds"],
                      "checkpoint_sha256": result["checkpoint_sha256"]}))
