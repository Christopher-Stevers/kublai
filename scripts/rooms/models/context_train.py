"""Local GPU experiment: overview and native tiles, no production changes."""
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

from common import HEADS, checked_asset, file_hash, private_dir, read_manifest, source_hashes, write_json
from context_network import ContextUNet, VERSION
from network import supervised_loss


def read_context_manifest(path):
    data = read_manifest(path)
    if data.get("experiment") != VERSION:
        raise ValueError("This experiment requires the whole-sheet development manifest")
    sites, assets, identifiers = {}, {}, set()
    for record in data["records"]:
        ident = record["id"]
        if not isinstance(ident, str) or not ident or Path(ident).name != ident or ident in identifiers:
            raise ValueError("Case identifiers must be unique plain filenames")
        identifiers.add(ident)
        if record["source"] == "synthetic-msd":
            site = str(record["site"])
            if sites.setdefault(site, record["split"]) != record["split"]:
                raise ValueError("One MSD site occurs in both splits despite different group aliases")
        image_hash = record["image_sha256"]
        if assets.setdefault(image_hash, record["split"]) != record["split"]:
            raise ValueError("Identical input images occur in both splits")
        checked_asset(path.parent, record["overview"], record["overview_sha256"])
    return data


class ContextTiles(Dataset):
    """Verified immutable in-memory asset snapshots prevent mid-run drift."""
    def __init__(self, manifest, split, tile, patches, seed):
        self.tile, self.patches, self.seed, self.epoch = tile, patches, seed, 0
        data = read_context_manifest(manifest)
        self.overview_size = data["overview"]
        self.records = [r for r in data["records"] if r["split"] == split]
        self.snapshots = []
        for record in self.records:
            image_path = checked_asset(manifest.parent, record["image"], record["image_sha256"])
            target_path = checked_asset(manifest.parent, record["targets"], record["targets_sha256"])
            coarse_path = checked_asset(manifest.parent, record["overview"], record["overview_sha256"])
            image = np.asarray(Image.open(image_path).convert("RGB")).copy()
            with np.load(target_path) as arrays:
                target, known = arrays["target"].copy(), arrays["known"].copy()
            with np.load(coarse_path) as arrays:
                coarse, coarse_known = arrays["target"].copy(), arrays["known"].copy()
            if target.shape != known.shape or target.shape != (len(HEADS), *image.shape[:2]):
                raise ValueError("Page RGB/target dimensions differ")
            if coarse.shape != coarse_known.shape or coarse.shape != (len(HEADS), self.overview_size, self.overview_size):
                raise ValueError("Overview target dimensions differ")
            overview = np.asarray(Image.fromarray(image).resize((self.overview_size, self.overview_size), Image.Resampling.LANCZOS)).copy()
            for name, hash_name in (("image", "image_sha256"), ("targets", "targets_sha256"), ("overview", "overview_sha256")):
                checked_asset(manifest.parent, record[name], record[hash_name])
            self.snapshots.append((image, target, known, overview, coarse, coarse_known))

    def __len__(self):
        return len(self.records) * self.patches

    def __getitem__(self, index):
        image, target, known, overview, coarse, coarse_known = self.snapshots[index // self.patches]
        rng = random.Random(self.seed + index * 65537 + self.epoch * 104729)
        rotations = rng.randrange(4)
        image, overview = np.rot90(image, rotations), np.rot90(overview, rotations)
        target, known = np.rot90(target, rotations, axes=(1, 2)), np.rot90(known, rotations, axes=(1, 2))
        coarse, coarse_known = np.rot90(coarse, rotations, axes=(1, 2)), np.rot90(coarse_known, rotations, axes=(1, 2))
        if rng.random() < 0.5:
            image, overview = image[:, ::-1], overview[:, ::-1]
            target, known = target[:, :, ::-1], known[:, :, ::-1]
            coarse, coarse_known = coarse[:, :, ::-1], coarse_known[:, :, ::-1]
        height, width = image.shape[:2]
        x, y = rng.randrange(max(1, width - self.tile + 1)), rng.randrange(max(1, height - self.tile + 1))
        choice = rng.random()
        anchor = target[0] if choice < 0.5 else target[2] if choice < 0.75 else None
        if anchor is not None:
            positive = np.flatnonzero(anchor)
            if len(positive):
                yy, xx = divmod(int(positive[rng.randrange(len(positive))]), width)
                x = max(0, min(width - self.tile, xx - self.tile // 2))
                y = max(0, min(height - self.tile, yy - self.tile // 2))
        h, w = min(self.tile, height - y), min(self.tile, width - x)
        pixels = np.ones((self.tile, self.tile, 3), dtype=np.float32)
        expected = np.zeros((len(HEADS), self.tile, self.tile), dtype=np.float32)
        mask = np.zeros_like(expected)
        pixels[:h, :w] = image[y:y + h, x:x + w].astype(np.float32) / 255
        expected[:, :h, :w] = target[:, y:y + h, x:x + w]
        mask[:, :h, :w] = known[:, y:y + h, x:x + w]
        boxes = np.array([x / width, y / height, (x + self.tile) / width, (y + self.tile) / height], dtype=np.float32)
        return (torch.from_numpy(pixels.transpose(2, 0, 1).copy()),
                torch.from_numpy(overview.transpose(2, 0, 1).copy()).float() / 255,
                torch.from_numpy(boxes), torch.from_numpy(expected), torch.from_numpy(mask),
                torch.from_numpy(coarse.copy()).float(), torch.from_numpy(coarse_known.copy()).float())


def run(args):
    if args.device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("A functioning CUDA runtime is required")
    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)
    torch.set_num_threads(args.threads)
    torch.backends.cudnn.deterministic, torch.backends.cudnn.benchmark = True, False
    data_hash, sources = file_hash(args.manifest), source_hashes()
    train = ContextTiles(args.manifest, "train", args.tile, args.patches, args.seed)
    validation = ContextTiles(args.manifest, "validation", args.tile, args.patches, args.seed + 1)
    if not len(train) or not len(validation):
        raise ValueError("Separate whole-site train and validation groups are required")
    if file_hash(args.manifest) != data_hash or source_hashes() != sources:
        raise RuntimeError("Sources changed while taking the training snapshot")
    private_dir(args.output)
    device = torch.device(args.device)
    model = ContextUNet(args.base, args.context_base).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr)
    loaders = {"train": DataLoader(train, batch_size=args.batch, shuffle=True, num_workers=0),
               "validation": DataLoader(validation, batch_size=args.batch, shuffle=False, num_workers=0)}
    config = {key: str(value) if isinstance(value, Path) else value for key, value in vars(args).items()}
    metadata = {"version": VERSION, "heads": list(HEADS), "architecture": "rgb-overview-conditioned-local-unet",
                "base": args.base, "context_base": args.context_base, "overview": train.overview_size, "tile": args.tile,
                "source_hashes": sources, "manifest_sha256": data_hash, "config": config,
                "parameters": sum(p.numel() for p in model.parameters()),
                "runtime": {"torch": torch.__version__, "cuda": torch.version.cuda,
                            "device": torch.cuda.get_device_name(device) if device.type == "cuda" else "CPU"},
                "asset_snapshot": "Every image/target/overview was verified before and after decoding, then trained from immutable in-memory arrays.",
                "approved_for_production": False,
                "limitations": "Simulated whole-sheet validation does not establish construction drawing room completeness."}
    best, history, started = float("inf"), [], time.monotonic()
    if device.type == "cuda":
        torch.cuda.reset_peak_memory_stats(device)
    for epoch in range(args.epochs):
        if file_hash(args.manifest) != data_hash or source_hashes() != sources:
            raise RuntimeError("Source/manifest changed; stop and begin a new versioned run")
        train.epoch = epoch
        losses = {}
        for split, loader in loaders.items():
            model.train(split == "train")
            total, samples = 0.0, 0
            for batch in loader:
                tile, overview, boxes, target, known, coarse_target, coarse_known = [v.to(device) for v in batch]
                optimizer.zero_grad(set_to_none=True)
                with torch.set_grad_enabled(split == "train"):
                    with torch.autocast("cuda", dtype=torch.bfloat16) if device.type == "cuda" else nullcontext():
                        local, coarse = model(tile, overview, boxes)
                        loss = supervised_loss(local, target, known) + args.context_weight * supervised_loss(coarse, coarse_target, coarse_known)
                    if not bool(torch.isfinite(loss)):
                        raise RuntimeError("Nonfinite loss; invalid checkpoints are not saved")
                    if split == "train":
                        loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); optimizer.step()
                total += float(loss.detach()) * tile.shape[0]; samples += tile.shape[0]
            losses[split] = total / samples
        row = {"epoch": epoch + 1, "loss": losses, "elapsed_seconds": time.monotonic() - started}
        history.append(row); print(json.dumps(row), flush=True)
        if file_hash(args.manifest) != data_hash or source_hashes() != sources:
            raise RuntimeError("Source/manifest changed before checkpoint save")
        if losses["validation"] < best:
            best = losses["validation"]
            torch.save({"weights": {name: value.detach().cpu() for name, value in model.state_dict().items()},
                        "metadata_json": json.dumps({**metadata, "selected_epoch": epoch + 1,
                                                     "selection": "Lowest new site-disjoint development validation loss."})}, args.output / "best.pt")
            (args.output / "best.pt").chmod(0o600)
    result = {**metadata, "history": history, "wall_seconds": time.monotonic() - started,
              "peak_cuda_allocated_mib": torch.cuda.max_memory_allocated(device) / 2 ** 20 if device.type == "cuda" else 0,
              "checkpoint": "best.pt", "checkpoint_sha256": file_hash(args.output / "best.pt")}
    write_json(args.output / "run.json", result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True); parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=8); parser.add_argument("--tile", type=int, default=512)
    parser.add_argument("--batch", type=int, default=2); parser.add_argument("--patches", type=int, default=4)
    parser.add_argument("--base", type=int, default=16); parser.add_argument("--context-base", type=int, default=8)
    parser.add_argument("--context-weight", type=float, default=0.5); parser.add_argument("--lr", type=float, default=0.001)
    parser.add_argument("--seed", type=int, default=20260930); parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--device", choices=["cuda", "cpu"], default="cuda")
    args = parser.parse_args()
    if min(args.epochs, args.batch, args.patches, args.threads) < 1 or args.tile < 32 or args.tile % 16 or not 0 < args.context_weight <= 1:
        parser.error("Positive sizes, bounded context weight, and tile divisible by sixteen are required")
    os.umask(0o077); run(args)
