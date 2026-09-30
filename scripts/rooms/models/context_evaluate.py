"""Paired v1/context/geometry ranking on identical new development pages."""
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

from common import HEADS, REPO, checked_asset, file_hash, private_dir, read_manifest, source_hashes, write_json
from context_network import VERSION
from context_predict import context_probabilities, load_context_model, runtime_versions, verify_hashes
from context_train import read_context_manifest
from predict import global_rooms, load_model, stitched_probabilities

sys.path.insert(0, str(REPO / "scripts/rooms/bench"))
from metrics import aggregate, score


def geometry_sources():
    # Keep this local: build_data adds complete/ to sys.path, where another
    # evaluate.py is an executable script rather than an importable module.
    files = [*REPO.joinpath("src/server/rooms/hybrid").glob("*.ts"),
             REPO / "src/server/rooms/raster-rooms.ts", REPO / "src/lib/room-shape.ts",
             REPO / "scripts/rooms/complete/predict.ts", REPO / "scripts/rooms/bench/metrics.py",
             REPO / "package.json", REPO / "pnpm-lock.yaml", REPO / "tsconfig.json"]
    return {str(path.relative_to(REPO)): file_hash(path) for path in sorted(files)}


def geometry_runtime(node):
    expression = ('JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,'
                  'canvas:require("@napi-rs/canvas/package.json").version,'
                  'tsx:require("tsx/package.json").version,pdfjs:require("pdfjs-dist/package.json").version})')
    process = subprocess.run([node, "-p", expression], cwd=REPO, capture_output=True,
                             text=True, check=True, timeout=30)
    return json.loads(process.stdout)


def v1_training_sites(metadata):
    path = Path(metadata["config"]["manifest"])
    if file_hash(path) != metadata["manifest_sha256"]:
        raise ValueError("Frozen pilot training manifest no longer matches")
    return {r["site"] for r in read_manifest(path)["records"]
            if r["split"] == "train" and r["source"] == "synthetic-msd"}


def pixel_scores(probability, target, known):
    result = {}
    for head, name in enumerate(HEADS):
        observed = known[head].astype(bool)
        actual = target[head].astype(bool)
        predicted = probability[head] >= 0.5
        tp = int(np.count_nonzero(observed & actual & predicted))
        fp = int(np.count_nonzero(observed & ~actual & predicted))
        fn = int(np.count_nonzero(observed & actual & ~predicted))
        result[name] = {"tp": tp, "fp": fp, "fn": fn, "known": int(observed.sum())}
    return result


def summarize_pixels(rows):
    result = {}
    for name in HEADS:
        sums = {key: sum(row["pixel_metrics"][name][key] for row in rows) for key in ("tp", "fp", "fn", "known")}
        tp, fp, fn = sums["tp"], sums["fp"], sums["fn"]
        result[name] = {**sums, "recall": tp / (tp + fn) if tp + fn else None,
                        "precision": tp / (tp + fp) if tp + fp else None,
                        "iou": tp / (tp + fp + fn) if tp + fp + fn else None}
    return result


def full_space_case(record):
    """Partial positive review targets can train, but cannot define floor recall."""
    if record.get("source") == "synthetic-msd":
        return True
    return (record.get("source") == "reviewed-floor" and record.get("completeness_attested") is True
            and record.get("full_space_evaluation_eligible") is True)


def run(args):
    sources, reference = source_hashes(), geometry_sources()
    frozen = {args.manifest: file_hash(args.manifest), args.checkpoint: file_hash(args.checkpoint),
              args.pilot_checkpoint: file_hash(args.pilot_checkpoint)}
    data_hash = frozen[args.manifest]
    manifest = read_context_manifest(args.manifest)
    verify_hashes(frozen)
    if manifest.get("experiment") != VERSION:
        raise ValueError("Use the new whole-sheet development manifest")
    validation = [r for r in manifest["records"] if r["split"] == "validation"]
    cases = [r for r in validation if full_space_case(r)][:args.limit]
    skipped = [r["id"] for r in validation if not full_space_case(r)]
    if not cases:
        raise ValueError("Separate fully annotated development validation is required")
    torch.set_num_threads(args.threads)
    device = torch.device(args.device)
    context, metadata = load_context_model(args.checkpoint, device)
    verify_hashes(frozen)
    if metadata["manifest_sha256"] != data_hash:
        raise ValueError("Context checkpoint requires its exact training/validation manifest")
    pilot, pilot_metadata = load_model(args.pilot_checkpoint, device)
    verify_hashes(frozen)
    pilot_manifest = Path(pilot_metadata["config"]["manifest"])
    frozen[pilot_manifest] = pilot_metadata["manifest_sha256"]
    if v1_training_sites(pilot_metadata) & {r["site"] for r in cases if r["source"] == "synthetic-msd"}:
        raise ValueError("A new validation site overlaps frozen-pilot training")
    private_dir(args.output)
    reference_runtime = geometry_runtime(args.node)
    for case in cases:
        for name, hash_name in (("image", "image_sha256"), ("targets", "targets_sha256"), ("overview", "overview_sha256")):
            path = checked_asset(args.manifest.parent, case[name], case[hash_name])
            frozen[path] = case[hash_name]
    methods = {"context": [], "frozen_pilot": [], "geometry": []}
    for case in cases:
        verify_hashes(frozen)
        if source_hashes() != sources or geometry_sources() != reference or file_hash(args.manifest) != data_hash:
            raise RuntimeError("Source/manifest changed; comparison is not rankable")
        target_path = checked_asset(args.manifest.parent, case["targets"], case["targets_sha256"])
        image_path = checked_asset(args.manifest.parent, case["image"], case["image_sha256"])
        with np.load(target_path) as arrays:
            truth = arrays["truth"].copy()
            target, known = arrays["target"].copy(), arrays["known"].copy()
        with Image.open(image_path) as source:
            image = np.asarray(source.convert("RGB"), dtype=np.float32) / 255
        verify_hashes({target_path: case["targets_sha256"], image_path: case["image_sha256"]})
        for name, model, info in (("context", context, metadata), ("frozen_pilot", pilot, pilot_metadata)):
            started = time.monotonic()
            if name == "context":
                probability, _ = context_probabilities(model, image, info["tile"], args.overlap, info["overview"], device)
            else:
                probability = stitched_probabilities(model, image, info["tile"], args.overlap, device)
            labels, rooms = global_rooms(probability, args.boundary_threshold, args.interior_threshold)
            methods[name].append({"id": case["id"], "group": case["group"], "status": "ok",
                                  "metrics": score(truth, labels), "exported_polygons": len(rooms),
                                  "pixel_metrics": pixel_scores(probability, target, known),
                                  "timing": {"wall_ms": (time.monotonic() - started) * 1000}})
        mask, request = args.output / f"{case['id']}.geometry.i32", args.output / f"{case['id']}.request.json"
        write_json(request, {"image": str(image_path.resolve()), "output": str(mask.resolve()), "mode": "complete", "seeds": []})
        # Geometry reopens this path; it must see the exact bytes the models saw.
        verify_hashes({image_path: case["image_sha256"]})
        started = time.monotonic()
        proc = subprocess.run([args.node, "--max-old-space-size=768", "--import", "tsx", "scripts/rooms/complete/predict.ts", str(request.resolve())],
                              cwd=REPO, capture_output=True, text=True, timeout=180)
        if proc.returncode:
            raise RuntimeError("Geometry adapter failed; comparison is invalid")
        verify_hashes({image_path: case["image_sha256"], target_path: case["targets_sha256"]})
        labels = np.fromfile(mask, dtype="<i4").reshape(truth.shape)
        methods["geometry"].append({"id": case["id"], "group": case["group"], "status": "ok",
                                    "metrics": score(truth, labels), "timing": {"wall_ms": (time.monotonic() - started) * 1000}})
        print(json.dumps({"validation": len(methods["context"]), "total": len(cases), "id": case["id"]}), flush=True)
    result = {"version": VERSION, "split": "new-whole-sheet-model-development", "ids": [r["id"] for r in cases],
              "partial_validation_ids_excluded": skipped,
              "manifest_sha256": data_hash, "checkpoint_sha256": frozen[args.checkpoint],
              "pilot_checkpoint_sha256": frozen[args.pilot_checkpoint], "pilot_training_manifest_sha256": pilot_metadata["manifest_sha256"],
              "source_hashes": sources, "geometry_source_hashes": reference,
              "runtime": {**runtime_versions(), "device": torch.cuda.get_device_name(device) if device.type == "cuda" else "CPU"},
              "geometry_runtime": reference_runtime,
              "tiling": {"context_tile": metadata["tile"], "pilot_tile": pilot_metadata["tile"],
                         "overview": metadata["overview"], "overlap": args.overlap},
              "thresholds": {"boundary": args.boundary_threshold, "interior": args.interior_threshold},
              "pixel_threshold": 0.5,
              "results": {name: {"cases": rows, "summary": aggregate(rows),
                         **({"pixel_summary": summarize_pixels(rows)} if name != "geometry" else {})}
                         for name, rows in methods.items()},
              "limitations": "New site-disjoint procedural multi-layout development sheets; not construction-sheet recall. Model timing excludes loading; geometry timing includes Node startup. No protected holdout opened or tuned."}
    verify_hashes(frozen)
    if source_hashes() != sources or geometry_sources() != reference or geometry_runtime(args.node) != reference_runtime:
        raise RuntimeError("Sources changed before report save")
    write_json(args.output / "report.json", result)
    print(json.dumps({name: value["summary"] for name, value in result["results"].items()}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True); parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--pilot-checkpoint", type=Path, required=True); parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=20); parser.add_argument("--device", choices=["cuda", "cpu"], default="cuda")
    parser.add_argument("--overlap", type=int, default=128); parser.add_argument("--boundary-threshold", type=float, default=0.5)
    parser.add_argument("--interior-threshold", type=float, default=0.35); parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--node", default="node"); args = parser.parse_args()
    if args.limit < 1 or args.threads < 1:
        parser.error("Positive validation and resource limits are required")
    os.umask(0o077); run(args)
