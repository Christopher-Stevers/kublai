"""Rank local model versus geometry on new site-disjoint model validation only."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import numpy as np
from PIL import Image
import torch

from common import REPO, VERSION, checked_asset, file_hash, private_dir, read_manifest, source_hashes, write_json
from context_evaluate import geometry_runtime
from context_predict import runtime_versions, verify_hashes
from predict import global_rooms, load_model, stitched_probabilities

sys.path.insert(0, str(REPO / "scripts/rooms/bench"))
from metrics import aggregate, score


def geometry_sources() -> dict[str, str]:
    files = [*REPO.joinpath("src/server/rooms/hybrid").glob("*.ts"),
             REPO / "src/server/rooms/raster-rooms.ts", REPO / "src/lib/room-shape.ts",
             REPO / "scripts/rooms/complete/predict.ts", REPO / "scripts/rooms/bench/metrics.py",
             REPO / "package.json", REPO / "pnpm-lock.yaml", REPO / "tsconfig.json"]
    return {str(p.relative_to(REPO)): file_hash(p) for p in sorted(files)}


def run(args):
    sources = source_hashes()
    reference = geometry_sources() if args.geometry else {}
    frozen = {args.manifest: file_hash(args.manifest), args.checkpoint: file_hash(args.checkpoint)}
    manifest = read_manifest(args.manifest)
    selected = [r for r in manifest["records"] if r["split"] == "validation"][:args.limit]
    # Partial reviewed positives have no defensible total room count.
    cases = [r for r in selected if r["source"] == "synthetic-msd" or r.get("completeness_attested") is True]
    if not cases:
        raise ValueError("No fully supervised validation floors; partial reviews cannot measure completeness")
    for case in cases:
        for key in ("image", "targets"):
            asset = checked_asset(args.manifest.parent, case[key], case[key + "_sha256"])
            frozen[asset] = case[key + "_sha256"]
    verify_hashes(frozen)
    device = torch.device(args.device)
    torch.set_num_threads(args.threads)
    model, metadata = load_model(args.checkpoint, device)
    verify_hashes(frozen)
    if metadata["manifest_sha256"] != frozen[args.manifest]:
        raise ValueError("Evaluate using the checkpoint's exact training/validation manifest")
    private_dir(args.output)
    reference_runtime = geometry_runtime(args.node) if args.geometry else None
    methods = {"model": [], **({"geometry": []} if args.geometry else {})}
    for case in cases:
        verify_hashes(frozen)
        if source_hashes() != sources or (args.geometry and geometry_sources() != reference):
            raise RuntimeError("Source changed during comparison; restart from frozen code")
        target_path = checked_asset(args.manifest.parent, case["targets"], case["targets_sha256"])
        with np.load(target_path) as data:
            truth = data["truth"].copy()
        image_path = checked_asset(args.manifest.parent, case["image"], case["image_sha256"])
        with Image.open(image_path) as rendered:
            image = np.asarray(rendered.convert("RGB"), dtype=np.float32) / 255
        verify_hashes({target_path: case["targets_sha256"], image_path: case["image_sha256"]})
        started = time.monotonic()
        probability = stitched_probabilities(model, image, metadata["tile"], args.overlap, device)
        prediction, _ = global_rooms(probability, args.boundary_threshold, args.interior_threshold)
        verify_hashes(frozen)
        methods["model"].append({"id": case["id"], "group": case["group"], "status": "ok",
                                 "metrics": score(truth, prediction),
                                 "timing": {"wall_ms": (time.monotonic() - started) * 1000}})
        if args.geometry:
            mask = args.output / f"{case['id']}.geometry.i32"
            request = args.output / f"{case['id']}.request.json"
            write_json(request, {"image": str(image_path.resolve()), "output": str(mask.resolve()),
                                 "mode": "complete", "seeds": []})
            verify_hashes({image_path: case["image_sha256"]})
            started = time.monotonic()
            proc = subprocess.run([args.node, "--max-old-space-size=768", "--import", "tsx",
                                   "scripts/rooms/complete/predict.ts", str(request.resolve())],
                                  cwd=REPO, capture_output=True, text=True, timeout=90)
            if proc.returncode:
                raise RuntimeError("Geometry adapter failed; comparison is invalid")
            prediction = np.fromfile(mask, dtype="<i4").reshape(truth.shape)
            verify_hashes({target_path: case["targets_sha256"], image_path: case["image_sha256"]})
            methods["geometry"].append({"id": case["id"], "group": case["group"], "status": "ok",
                                       "metrics": score(truth, prediction),
                                       "timing": {"wall_ms": (time.monotonic() - started) * 1000}})
        print(f"Validation cases: {len(methods['model'])}/{len(cases)}", flush=True)
    result = {"version": VERSION, "split": "model-validation", "ids": [r["id"] for r in cases],
              "manifest_sha256": frozen[args.manifest], "checkpoint_sha256": frozen[args.checkpoint],
              "source_hashes": sources, "geometry_source_hashes": reference,
              "geometry_runtime": reference_runtime, "runtime": runtime_versions(),
              "thresholds": {"boundary": args.boundary_threshold, "interior": args.interior_threshold},
              "results": {method: {"cases": rows, "summary": aggregate(rows)} for method, rows in methods.items()},
              "partial_review_floors_skipped": len(selected) - len(cases),
              "limitations": "These validation sites are excluded from all-spaces MSD development/holdout. Procedural synthetic room scores are not actual construction-sheet accuracy; all models remain unapproved."}
    verify_hashes(frozen)
    if source_hashes() != sources or (args.geometry and (geometry_sources() != reference or geometry_runtime(args.node) != reference_runtime)):
        raise RuntimeError("Source changed during evaluation; report is not rankable")
    write_json(args.output / "report.json", result)
    print(json.dumps({k: v["summary"] for k, v in result["results"].items()}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--device", choices=["cuda", "cpu"], default="cuda")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--overlap", type=int, default=128)
    parser.add_argument("--boundary-threshold", type=float, default=0.5)
    parser.add_argument("--interior-threshold", type=float, default=0.35)
    parser.add_argument("--geometry", action="store_true")
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    if args.limit < 1:
        parser.error("A positive validation limit is required")
    os.umask(0o077)
    run(args)
