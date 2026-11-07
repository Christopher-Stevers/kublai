"""Offline training of an unapproved structural challenger; no provider calls."""
from __future__ import annotations

import argparse
from contextlib import nullcontext
import json
import os
from pathlib import Path
import random
import time

import numpy as np
from PIL import Image
import torch
from torch.utils.data import DataLoader, Dataset

from common import HEADS, VERSION, checked_asset, file_hash, private_dir, read_manifest, source_hashes, write_json
from network import StructuralUNet, supervised_loss


class Tiles(Dataset):
    def __init__(self, manifest: Path, split: str, tile: int, patches: int, seed: int):
        self.root = manifest.parent
        manifest_data = read_manifest(manifest)
        sites, images = {}, {}
        for record in manifest_data["records"]:
            if record["source"] == "synthetic-msd":
                site = str(record["site"])
                if sites.setdefault(site, record["split"]) != record["split"]:
                    raise ValueError("One site occurs in both splits despite different group aliases")
            image_hash = record["image_sha256"]
            if images.setdefault(image_hash, record["split"]) != record["split"]:
                raise ValueError("Identical input images occur in both splits")
        self.records = [r for r in manifest_data["records"] if r["split"] == split]
        self.tile, self.patches, self.seed, self.epoch = tile, patches, seed, 0

    def __len__(self):
        return len(self.records) * self.patches

    def __getitem__(self, index):
        record = self.records[index // self.patches]
        image_path = checked_asset(self.root, record["image"], record["image_sha256"])
        target_path = checked_asset(self.root, record["targets"], record["targets_sha256"])
        image = np.asarray(Image.open(image_path).convert("RGB"), dtype=np.float32) / 255
        with np.load(target_path) as data:
            target, known = data["target"].astype(np.float32), data["known"].astype(np.float32)
        checked_asset(self.root, record["image"], record["image_sha256"])
        checked_asset(self.root, record["targets"], record["targets_sha256"])
        if target.shape != known.shape or target.shape != (len(HEADS), *image.shape[:2]):
            raise ValueError("Image and three-head target dimensions must match")
        height, width = image.shape[:2]
        rng = random.Random(self.seed + index * 65537 + self.epoch * 104729)
        x, y = rng.randrange(max(1, width - self.tile + 1)), rng.randrange(max(1, height - self.tile + 1))
        # Mix uniform crops with interior-centered crops; retain background
        # examples rather than teaching that every white pixel is a room.
        positives = np.argwhere(target[0] > 0)
        if len(positives) and rng.random() < 0.5:
            cy, cx = positives[rng.randrange(len(positives))]
            x = max(0, min(width - self.tile, int(cx) - self.tile // 2))
            y = max(0, min(height - self.tile, int(cy) - self.tile // 2))
        actual_w, actual_h = min(self.tile, width - x), min(self.tile, height - y)
        pixels = np.ones((self.tile, self.tile, 3), dtype=np.float32)
        expected = np.zeros((len(HEADS), self.tile, self.tile), dtype=np.float32)
        mask = np.zeros_like(expected)
        pixels[:actual_h, :actual_w] = image[y:y + actual_h, x:x + actual_w]
        expected[:, :actual_h, :actual_w] = target[:, y:y + actual_h, x:x + actual_w]
        mask[:, :actual_h, :actual_w] = known[:, y:y + actual_h, x:x + actual_w]
        rotations = rng.randrange(4)
        pixels = np.rot90(pixels, rotations)
        expected, mask = np.rot90(expected, rotations, axes=(1, 2)), np.rot90(mask, rotations, axes=(1, 2))
        if rng.random() < 0.5:
            pixels, expected, mask = pixels[:, ::-1], expected[:, :, ::-1], mask[:, :, ::-1]
        return (torch.from_numpy(pixels.transpose(2, 0, 1).copy()),
                torch.from_numpy(expected.copy()), torch.from_numpy(mask.copy()))


def run(args) -> dict:
    if args.device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA requested but no working GPU runtime is available")
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(args.threads)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False
    device = torch.device(args.device)
    train = Tiles(args.manifest, "train", args.tile, args.patches, args.seed)
    validation = Tiles(args.manifest, "validation", args.tile, args.patches, args.seed + 1)
    if not len(train) or not len(validation):
        raise ValueError("Training and site/project-disjoint validation data are both required")
    private_dir(args.output)
    data_hash, sources = file_hash(args.manifest), source_hashes()
    model = StructuralUNet(args.base).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr)
    loaders = {"train": DataLoader(train, batch_size=args.batch, shuffle=True, num_workers=0),
               "validation": DataLoader(validation, batch_size=args.batch, shuffle=False, num_workers=0)}
    config = vars(args).copy()
    for name, value in config.items():
        if isinstance(value, Path):
            config[name] = str(value)
    metadata = {"version": VERSION, "architecture": "compact-unet-v1", "heads": list(HEADS),
                "base": args.base, "tile": args.tile, "config": config, "seed": args.seed,
                "source_hashes": sources, "manifest_sha256": data_hash,
                "parameters": sum(p.numel() for p in model.parameters()),
                "runtime": {"torch": torch.__version__, "cuda": torch.version.cuda,
                            "device": torch.cuda.get_device_name(device) if device.type == "cuda" else "CPU"},
                "determinism": "Seeded samples and cuDNN deterministic mode; cross-hardware bit equality is not asserted.",
                "approved_for_production": False,
                "limitations": "Validation loss on procedural MSD ink is not construction-sheet room recall or proof of completeness."}
    history, best = [], float("inf")
    started = time.monotonic()
    if device.type == "cuda":
        torch.cuda.reset_peak_memory_stats(device)
    for epoch in range(args.epochs):
        if file_hash(args.manifest) != data_hash or source_hashes() != sources:
            raise RuntimeError("Training source/manifest changed; stop and start a fresh versioned run")
        train.epoch = epoch
        losses = {}
        for split, loader in loaders.items():
            model.train(split == "train")
            total, samples = 0.0, 0
            for image, target, known in loader:
                image, target, known = image.to(device), target.to(device), known.to(device)
                optimizer.zero_grad(set_to_none=True)
                with torch.set_grad_enabled(split == "train"):
                    with torch.autocast("cuda", dtype=torch.bfloat16) if device.type == "cuda" else nullcontext():
                        loss = supervised_loss(model(image), target, known)
                    if not bool(torch.isfinite(loss)):
                        raise RuntimeError("Nonfinite training loss; no invalid checkpoint will be saved")
                    if split == "train":
                        loss.backward()
                        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                        optimizer.step()
                total += float(loss.detach()) * image.shape[0]
                samples += image.shape[0]
            losses[split] = total / samples
        row = {"epoch": epoch + 1, "loss": losses, "elapsed_seconds": time.monotonic() - started}
        history.append(row)
        print(json.dumps(row), flush=True)
        if file_hash(args.manifest) != data_hash or source_hashes() != sources:
            raise RuntimeError("Training source/manifest changed before checkpoint save")
        read_manifest(args.manifest)  # Reverify exact bytes, including assets used in the last batch.
        if losses["validation"] < best:
            best = losses["validation"]
            checkpoint = {"weights": {name: value.detach().cpu() for name, value in model.state_dict().items()},
                          "metadata_json": json.dumps({**metadata, "selected_epoch": epoch + 1,
                                                       "selection": "Lowest site-disjoint validation supervised loss."})}
            torch.save(checkpoint, args.output / "best.pt")
            (args.output / "best.pt").chmod(0o600)
    read_manifest(args.manifest)
    result = {**metadata, "history": history, "wall_seconds": time.monotonic() - started,
              "peak_cuda_allocated_mib": torch.cuda.max_memory_allocated(device) / 2 ** 20 if device.type == "cuda" else 0,
              "checkpoint": "best.pt", "checkpoint_sha256": file_hash(args.output / "best.pt")}
    write_json(args.output / "run.json", result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--tile", type=int, default=512)
    parser.add_argument("--batch", type=int, default=2)
    parser.add_argument("--patches", type=int, default=4)
    parser.add_argument("--base", type=int, default=16)
    parser.add_argument("--lr", type=float, default=0.001)
    parser.add_argument("--seed", type=int, default=1729)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--device", choices=["cuda", "cpu"], default="cuda")
    args = parser.parse_args()
    if min(args.epochs, args.batch, args.patches, args.threads) < 1 or args.tile < 32 or args.tile % 16:
        parser.error("Positive sizes and a tile divisible by sixteen are required")
    os.umask(0o077)
    run(args)
