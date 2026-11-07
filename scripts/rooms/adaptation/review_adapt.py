"""Offline review adaptation with fixed parent, replay and no automatic promotion."""
from __future__ import annotations

import argparse
from contextlib import nullcontext
import json
import math
import os
from pathlib import Path
import random
import shutil
import time

import numpy as np
from PIL import Image
import torch
from torch.utils.data import DataLoader, WeightedRandomSampler

from contract import (BASE_SHA, CONFIG, MODELS, PARENT_DIR, PARENT_SHA, PARENT_RUN_SHA,
                      adaptation_weights, metadata_preflight, preflight, require, verify)
from common import HEADS, REPO, canonical_hash, file_hash, private_dir, source_hashes, write_json
from context_predict import load_context_model, runtime_versions
from context_train import ContextTiles
from context_network import VERSION
from network import supervised_loss
from build_data import FEEDBACK_ADAPTER


def producer_sources():
    return {p.resolve(): file_hash(p) for p in [*Path(__file__).parent.glob("*.py"), *MODELS.glob("*.py"), FEEDBACK_ADAPTER]}


def check_selected(output, best_hash):
    if best_hash is not None:
        require(file_hash(output / "best.pt") == best_hash, "Selected checkpoint changed between epochs")


def select_review_validation(dataset):
    admitted = [i for i, row in enumerate(dataset.records) if row["source"] == "reviewed-floor"]
    require(bool(admitted), "Separate reviewed validation is required")
    dataset.records = [dataset.records[i] for i in admitted]
    dataset.snapshots = [dataset.snapshots[i] for i in admitted]


def run(manifest, output, device_name):
    # Neither CUDA nor native training assets are decoded before eligibility.
    manifest, output = manifest.resolve(), output.resolve()
    require(not output.resolve().is_relative_to(REPO.resolve()), "Model output must stay outside the repository")
    sources = producer_sources()
    runtime = runtime_versions()
    frozen = {manifest.resolve(): file_hash(manifest), (PARENT_DIR / "best.pt").resolve(): PARENT_SHA,
              (PARENT_DIR / "run.json").resolve(): PARENT_RUN_SHA}
    verify(frozen); verify(sources)
    metadata_preflight(manifest)
    verify(frozen); verify(sources)
    checkpoint, parent_run = PARENT_DIR / "best.pt", PARENT_DIR / "run.json"
    require(file_hash(checkpoint) == PARENT_SHA, "Only the fixed completed context parent is allowed")
    parent_report = json.loads(parent_run.read_text())
    require(parent_report["manifest_sha256"] == BASE_SHA and parent_report["checkpoint_sha256"] == PARENT_SHA,
            "Parent run/base/checkpoint lineage differs")
    require(len(parent_report["history"]) == 48 and [r["epoch"] for r in parent_report["history"]] == list(range(1, 49)),
            "Parent training did not complete its declared 48 epochs")
    model, parent_metadata = load_context_model(checkpoint, torch.device("cpu"))
    require(parent_metadata["manifest_sha256"] == BASE_SHA and parent_metadata["tile"] == CONFIG["tile"] and parent_metadata["overview"] == 512,
            "Parent architecture/grid/base differ")
    selected = min(parent_report["history"], key=lambda r: r["loss"]["validation"])["epoch"]
    require(parent_metadata["selected_epoch"] == selected, "Parent checkpoint selection differs from completed run")
    verify(frozen); verify(sources)
    data, reviews, inputs = preflight(manifest)
    verify(frozen); verify(sources)
    frozen.update(inputs)
    architecture = source_hashes()
    require(runtime_versions() == runtime, "Runtime changed before claim")
    digest = canonical_hash({"manifest": file_hash(manifest), "parent": PARENT_SHA, "config": CONFIG})
    claims = PARENT_DIR.parent / "review-adaptation-claims"
    claims.mkdir(mode=0o700, exist_ok=True)
    # Dataset+parent+config claim lives outside output; switching output cannot reset it.
    claim = claims / (digest + ".json")
    write_json(claim, {"output": str(output.resolve()), "manifest_sha256": frozen[manifest.resolve()], "parent_sha256": PARENT_SHA,
                      "config": CONFIG, "sources": {str(p): h for p, h in sources.items()}, "runtime": runtime})
    frozen[claim.resolve()] = file_hash(claim)
    private_dir(output)
    archive = output / "frozen_sources"
    archive.mkdir(mode=0o700)
    for source in sources:
        relative = Path(source.parent.name) / source.name
        dest = archive / relative
        dest.parent.mkdir(mode=0o700, exist_ok=True)
        shutil.copyfile(source, dest); dest.chmod(0o600)
        frozen[dest] = sources[source]
    binding = output / "binding.json"
    write_json(binding, {"output": str(output.resolve()), "manifest": str(manifest.resolve()),
        "claim": str(claim.resolve()), "claim_sha256": frozen[claim.resolve()],
        "manifest_sha256": file_hash(manifest), "parent_sha256": PARENT_SHA,
        "parent_run_sha256": frozen[parent_run], "config": CONFIG, "device": device_name,
        "runtime": runtime, "inputs": {str(p): h for p, h in frozen.items()}, "sources": {str(p): h for p, h in sources.items()},
        "reviewed_training_floors": sum(r["split"] == "train" for r in reviews),
        "reviewed_validation_floors": sum(r["split"] == "validation" for r in reviews), "approved_for_production": False})
    frozen[binding.resolve()] = file_hash(binding)
    torch.set_num_threads(CONFIG["threads"])
    random.seed(CONFIG["seed"]); np.random.seed(CONFIG["seed"]); torch.manual_seed(CONFIG["seed"])
    torch.backends.cudnn.deterministic, torch.backends.cudnn.benchmark = True, False
    if device_name == "cuda":
        require(torch.cuda.is_available(), "CUDA is unavailable; no random/CPU fallback")
    device = torch.device(device_name)
    pixels_budget = 0
    for row in data["records"]:
        with Image.open(manifest.parent / row["image"]) as header:
            require(header.width * header.height <= 30_000_000, "Page exceeds thirty million native pixels")
            pixels_budget += header.width * header.height
    require(pixels_budget <= 1_000_000_000, "Training snapshot exceeds one billion native pixels")
    train = ContextTiles(manifest, "train", CONFIG["tile"], CONFIG["patches"], CONFIG["seed"])
    validation = ContextTiles(manifest, "validation", CONFIG["tile"], CONFIG["patches"], CONFIG["seed"] + 1)
    select_review_validation(validation)
    require(sum(s[0].shape[0] * s[0].shape[1] for s in train.snapshots + validation.snapshots) <= 1_000_000_000,
            "Training snapshot exceeds one billion native pixels")
    verify(frozen); verify(sources)
    model = model.to(device)
    sampler = WeightedRandomSampler(adaptation_weights(train.records, CONFIG["patches"]), len(train), replacement=True,
                                    generator=torch.Generator().manual_seed(CONFIG["seed"]))
    loaders = {"train": DataLoader(train, batch_size=CONFIG["batch"], sampler=sampler),
               "validation": DataLoader(validation, batch_size=CONFIG["batch"], shuffle=False)}
    optimizer = torch.optim.AdamW(model.parameters(), lr=CONFIG["lr"])
    history, best, best_hash, started = [], float("inf"), None, time.monotonic()
    if device_name == "cuda":
        torch.cuda.reset_peak_memory_stats(device)
    lineage = {"version": VERSION, "heads": list(HEADS), "architecture": parent_metadata["architecture"],
        "base": parent_metadata["base"], "context_base": parent_metadata["context_base"], "tile": CONFIG["tile"], "overview": data["overview"],
        "source_hashes": architecture, "manifest_sha256": file_hash(manifest), "parent_checkpoint_sha256": PARENT_SHA,
        "parent_run_sha256": PARENT_RUN_SHA,
        "adaptation": "verified-review-warm-start-v1", "config": CONFIG,
        "selection": "Lowest masked loss on separate reviewed validation jobs; never every-room accuracy.",
        "sampling": "Half expected training sampling mass on current reviews, half on unchanged synthetic replay.",
        "approved_for_production": False}
    for epoch in range(CONFIG["epochs"]):
        verify(frozen); verify(sources)
        check_selected(output, best_hash)
        require(runtime_versions() == runtime, "Runtime changed")
        train.epoch = epoch
        losses = {}
        for split, loader in loaders.items():
            model.train(split == "train")
            total, count = 0.0, 0
            for batch in loader:
                pixels, overview, boxes, target, known, coarse_target, coarse_known = [v.to(device) for v in batch]
                optimizer.zero_grad(set_to_none=True)
                with torch.set_grad_enabled(split == "train"):
                    with torch.autocast("cuda", dtype=torch.bfloat16) if device_name == "cuda" else nullcontext():
                        local, coarse = model(pixels, overview, boxes)
                        loss = supervised_loss(local, target, known) + CONFIG["context_weight"] * supervised_loss(coarse, coarse_target, coarse_known)
                    require(bool(torch.isfinite(loss)), "Nonfinite adaptation loss")
                    if split == "train":
                        loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); optimizer.step()
                total += float(loss.detach()) * pixels.shape[0]; count += pixels.shape[0]
            require(count > 0, "Empty adaptation split")
            losses[split] = total / count
        history.append({"epoch": epoch + 1, "loss": losses, "elapsed_seconds": time.monotonic() - started})
        print(json.dumps(history[-1]), flush=True)
        verify(frozen); verify(sources)
        # Check before an improving epoch overwrites the previously selected file.
        check_selected(output, best_hash)
        if losses["validation"] < best:
            best = losses["validation"]
            torch.save({"weights": {name: value.detach().cpu() for name, value in model.state_dict().items()},
                        "metadata_json": json.dumps({**lineage, "selected_epoch": epoch + 1})}, output / "best.pt")
            (output / "best.pt").chmod(0o600)
            best_hash = file_hash(output / "best.pt")
    verify(frozen); verify(sources)
    require(runtime_versions() == runtime, "Runtime changed before completion")
    require(best_hash is not None and file_hash(output / "best.pt") == best_hash, "Selected checkpoint changed before completion")
    result = {**lineage, "output": str(output.resolve()), "binding_sha256": frozen[binding.resolve()],
        "claim": str(claim.resolve()), "claim_sha256": frozen[claim.resolve()], "history": history, "runtime": runtime,
        "selected_epoch": min(history, key=lambda row: row["loss"]["validation"])["epoch"],
        "wall_seconds": time.monotonic() - started,
        "peak_cuda_allocated_mib": torch.cuda.max_memory_allocated(device) / 2 ** 20 if device_name == "cuda" else 0,
        "checkpoint_sha256": file_hash(output / "best.pt"),
        "limitations": "Copied PDF/preview association relies on recorded export provenance, not a cryptographic renderer receipt. Partial masked losses cannot establish every-room recall. Shared weights/decay can change unsupervised opening predictions. Physical-site aliases are unavailable; splits isolate jobs and exact PDFs/images only."}
    write_json(output / "run.json", result)
    completion = {"output": str(output.resolve()), "claim": str(claim.resolve()), "claim_sha256": frozen[claim.resolve()],
        "run_sha256": file_hash(output / "run.json"), "checkpoint_sha256": best_hash,
        "binding_sha256": frozen[binding.resolve()], "approved_for_production": False}
    write_json(output / "completed.json", completion)
    verify(frozen); verify(sources)
    write_json(claim.with_suffix(".completed.json"), {**completion, "completed_sha256": file_hash(output / "completed.json")})
    read_completed(output)
    return result


def read_completed(output):
    """Complete original-path lineage gate; no model or drawing decode."""
    output = output.resolve()
    frozen = {output / "completed.json": file_hash(output / "completed.json")}
    sources = producer_sources()
    runtime = runtime_versions()
    completion = json.loads((output / "completed.json").read_text())
    require(completion["output"] == str(output), "Copied output cannot reset completion lineage")
    claim = Path(completion["claim"])
    require(claim.is_absolute() and claim == claim.resolve() and claim.parent == (PARENT_DIR.parent / "review-adaptation-claims").resolve(), "Unexpected claim scope")
    frozen.update({p: file_hash(p) for p in (claim, claim.with_suffix(".completed.json"), output / "binding.json", output / "run.json", output / "best.pt")})
    require(frozen[claim] == completion["claim_sha256"], "Original adaptation claim changed")
    global_completion = json.loads(claim.with_suffix(".completed.json").read_text())
    require(global_completion == {**completion, "completed_sha256": frozen[output / "completed.json"]}, "Original completed receipt differs")
    for name, key in (("binding.json", "binding_sha256"), ("run.json", "run_sha256"), ("best.pt", "checkpoint_sha256")):
        require(frozen[output / name] == completion[key], "Completed output bytes changed")
    binding = json.loads((output / "binding.json").read_text())
    claim_data = json.loads(claim.read_text())
    report = json.loads((output / "run.json").read_text())
    require(binding["output"] == claim_data["output"] == str(output) and binding["claim"] == str(claim), "Original output/claim association differs")
    require(binding["claim_sha256"] == completion["claim_sha256"] and binding["config"] == claim_data["config"] == CONFIG, "Completed configuration differs")
    require(binding["manifest_sha256"] == claim_data["manifest_sha256"] and binding["parent_sha256"] == claim_data["parent_sha256"] == PARENT_SHA,
            "Completed data/parent lineage differs")
    manifest = Path(binding["manifest"])
    require(manifest.is_absolute() and manifest == manifest.resolve(), "Completed manifest path differs")
    require(claim.name == canonical_hash({"manifest": binding["manifest_sha256"], "parent": PARENT_SHA, "config": CONFIG}) + ".json", "Original claim digest differs")
    require(binding["parent_run_sha256"] == PARENT_RUN_SHA, "Completed parent run differs")
    require(binding["sources"] == claim_data["sources"] == {str(p): h for p, h in sources.items()} and bool(sources), "Completed producer sources differ")
    require(binding["runtime"] == claim_data["runtime"] == report["runtime"] == runtime, "Completed runtime differs from current runtime")
    inputs = {Path(p): h for p, h in binding["inputs"].items()}
    require(all(p.is_absolute() and p == p.resolve() for p in inputs), "Bound input path differs")
    mandatory = {manifest: binding["manifest_sha256"], (PARENT_DIR / "best.pt").resolve(): PARENT_SHA,
                 (PARENT_DIR / "run.json").resolve(): PARENT_RUN_SHA, claim: completion["claim_sha256"]}
    mandatory.update({output / "frozen_sources" / p.parent.name / p.name: h for p, h in sources.items()})
    require(all(inputs.get(p) == h for p, h in mandatory.items()), "Mandatory parent/input/archived source binding missing")
    require(not set(inputs).intersection(frozen) - {claim}, "Completed output cannot be a training input")
    for p, h in inputs.items():
        require(p not in frozen or frozen[p] == h, "Conflicting bound input")
        frozen[p] = h
    frozen.update(sources)
    require(report["output"] == str(output) and report["claim"] == str(claim) and report["claim_sha256"] == completion["claim_sha256"]
            and report["binding_sha256"] == completion["binding_sha256"] and report["checkpoint_sha256"] == completion["checkpoint_sha256"], "Completed run/output joins differ")
    require(report["manifest_sha256"] == binding["manifest_sha256"] and report["parent_checkpoint_sha256"] == PARENT_SHA and report["parent_run_sha256"] == PARENT_RUN_SHA
            and report["config"] == CONFIG and report["source_hashes"] == source_hashes(), "Completed run lineage differs")
    require(report["version"] == VERSION and report["heads"] == list(HEADS) and report["architecture"] == "rgb-overview-conditioned-local-unet"
            and report["base"] == 16 and report["context_base"] == 8 and report["tile"] == 512 and report["overview"] == 512
            and report["adaptation"] == "verified-review-warm-start-v1", "Completed model contract differs")
    require(all(row.get("approved_for_production") is False for row in (binding, report, completion)), "Adaptation cannot approve production")
    require(all(isinstance(binding[k], int) and 1 <= binding[k] <= 20 for k in ("reviewed_training_floors", "reviewed_validation_floors")), "Reviewed split counts missing")
    history = report["history"]
    require(len(history) == CONFIG["epochs"] and [r["epoch"] for r in history] == list(range(1, CONFIG["epochs"] + 1)), "Incomplete adaptation history")
    require(all(all(isinstance(r["loss"][k], (int, float)) and math.isfinite(r["loss"][k]) for k in ("train", "validation"))
                and math.isfinite(r["elapsed_seconds"]) and r["elapsed_seconds"] >= 0 for r in history), "Invalid adaptation history")
    require(report["selected_epoch"] == min(history, key=lambda row: row["loss"]["validation"])["epoch"], "Completed selection differs")
    require(report["selection"] == "Lowest masked loss on separate reviewed validation jobs; never every-room accuracy."
            and report["sampling"] == "Half expected training sampling mass on current reviews, half on unchanged synthetic replay.", "Completed adaptation policy differs")
    verify(frozen)
    require(runtime_versions() == runtime, "Runtime changed during completion verification")
    return completion


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    args = parser.parse_args(); os.umask(0o077)
    run(args.manifest, args.output, args.device)
