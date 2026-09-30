"""Rank declared native-wall presets on new development pages, never holdout."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import time

import numpy as np
from PIL import Image
import torch

from common import REPO, checked_asset, file_hash, private_dir, source_hashes, write_json
from context_evaluate import geometry_sources
from context_predict import context_probabilities, load_context_model, runtime_versions, verify_hashes
from context_train import read_context_manifest
from hybrid_native import PRESETS, VERSION, native_probabilities
from predict import global_rooms

sys.path.insert(0, str(REPO / "scripts/rooms/bench"))
from metrics import aggregate, score

INFERENCE_FILES = ("common.py", "network.py", "context_network.py", "context_predict.py", "predict.py")


def run(args):
    frozen = {path: file_hash(path) for path in (args.manifest, args.checkpoint, args.paired_report)}
    sources = source_hashes()
    paired = json.loads(args.paired_report.read_text())
    manifest = read_context_manifest(args.manifest)
    if paired["manifest_sha256"] != frozen[args.manifest] or paired["checkpoint_sha256"] != frozen[args.checkpoint]:
        raise ValueError("The paired reference must use this exact development dataset/checkpoint")
    # Geometry is not replayed here. Preserve its historical frozen fingerprint
    # and ensure the scoring implementation still matches; a web build changing
    # tsconfig must not be misrepresented as the config used for old scores.
    current_geometry = geometry_sources()
    score_name = "scripts/rooms/bench/metrics.py"
    if current_geometry[score_name] != paired["geometry_source_hashes"].get(score_name):
        raise ValueError("Scoring implementation changed; regenerate paired baseline first")
    for name in INFERENCE_FILES:
        if sources[name] != paired["source_hashes"].get(name):
            raise ValueError("Paired inference/polygonizer source changed; regenerate reference first")
    if paired["tiling"]["overlap"] != args.overlap or paired["thresholds"] != {"boundary": 0.5, "interior": 0.35}:
        raise ValueError("Paired tiling/polygon thresholds differ from this native comparison")
    cache_report = None
    if args.probability_cache:
        cache_path = args.probability_cache / "report.json"
        frozen[cache_path] = file_hash(cache_path)
        cache_report = json.loads(cache_path.read_text())
        if cache_report["manifest_sha256"] != frozen[args.manifest] or cache_report["checkpoint_sha256"] != frozen[args.checkpoint]:
            raise ValueError("Probability cache used different inputs/checkpoint")
        for name in INFERENCE_FILES:
            if cache_report["source_hashes"].get(name) != sources[name]:
                raise ValueError("Probability cache inference sources differ")
        if cache_report.get("overlap", 128) != args.overlap:
            raise ValueError("Probability cache tiling differs")
        cached_rows = {row["id"]: row for row in next(iter(cache_report["results"].values()))["cases"]}
    selected = set(paired["ids"])
    cases = [record for record in manifest["records"] if record["id"] in selected]
    if len(cases) != len(selected) or any(r["split"] != "validation" for r in cases):
        raise ValueError("Reference includes unknown or training cases")
    torch.set_num_threads(args.threads)
    device = torch.device(args.device)
    model, metadata = load_context_model(args.checkpoint, device)
    verify_hashes(frozen)
    private_dir(args.output)
    methods = {preset: [] for preset in PRESETS}
    for case in cases:
        if source_hashes() != sources:
            raise RuntimeError("Hybrid source changed during preset ranking")
        image_path = checked_asset(args.manifest.parent, case["image"], case["image_sha256"])
        target_path = checked_asset(args.manifest.parent, case["targets"], case["targets_sha256"])
        frozen[image_path], frozen[target_path] = case["image_sha256"], case["targets_sha256"]
        with Image.open(image_path) as source:
            image = np.asarray(source.convert("RGB"), dtype=np.float32) / 255
        with np.load(target_path) as arrays:
            truth = arrays["truth"].copy()
        verify_hashes({image_path: case["image_sha256"], target_path: case["targets_sha256"]})
        started = time.monotonic()
        if cache_report:
            cache = args.probability_cache / f"{case['id']}.probabilities.npz"
            if case["id"] not in cached_rows or file_hash(cache) != cached_rows[case["id"]]["probabilities_sha256"]:
                raise ValueError("Cached probability map changed or is missing")
            frozen[cache] = cached_rows[case["id"]]["probabilities_sha256"]
            with np.load(cache) as arrays:
                probability = arrays["probability"].copy()
            if probability.shape != (3, *truth.shape):
                raise ValueError("Cached probability dimensions differ")
            model_seconds = 0.0
        else:
            probability, _ = context_probabilities(model, image, metadata["tile"], args.overlap, metadata["overview"], device)
            model_seconds = time.monotonic() - started
            cache = args.output / f"{case['id']}.probabilities.npz"
            np.savez_compressed(cache, probability=probability)
            cache.chmod(0o600)
        for preset in PRESETS:
            started = time.monotonic()
            hybrid, diagnostics = native_probabilities(image, probability, preset)
            labels, rooms = global_rooms(hybrid)
            row = {"id": case["id"], "group": case["group"], "status": "ok", "metrics": score(truth, labels),
                   "diagnostics": diagnostics, "exported_polygons": len(rooms),
                   "timing": {"wall_ms": (model_seconds + time.monotonic() - started) * 1000},
                   "probabilities_sha256": file_hash(cache)}
            methods[preset].append(row)
        print(json.dumps({"development": len(methods["native_walls"]), "total": len(cases)}), flush=True)
    results = {name: {"cases": rows, "summary": aggregate(rows)} for name, rows in methods.items()}
    ranking = sorted(results, key=lambda name: (-results[name]["summary"]["f1_50"],
                                               results[name]["summary"]["merge_candidates"],
                                               -results[name]["summary"]["f1_75"]))
    verify_hashes(frozen)
    if source_hashes() != sources or geometry_sources() != current_geometry:
        raise RuntimeError("Sources changed; ranking is invalid")
    result = {"version": VERSION, "split": "new-whole-sheet-model-development", "manifest_sha256": frozen[args.manifest],
              "checkpoint_sha256": frozen[args.checkpoint], "paired_report_sha256": frozen[args.paired_report],
              "source_hashes": sources, "presets": PRESETS, "ranking": ranking,
              "historical_reference_geometry_source_hashes": paired["geometry_source_hashes"],
              "current_geometry_source_hashes": current_geometry,
              "geometry_replayed": False,
              "overlap": args.overlap, "polygon_thresholds": {"boundary": 0.5, "interior": 0.35, "minArea": 25},
              "probability_cache_report_sha256": frozen[args.probability_cache / "report.json"] if args.probability_cache else None,
              "selection": "Development F1 at IoU .5, then fewer merges, then F1 at .75; not an unseen-project success claim.",
              "results": results, "paired_reference": {name: value["summary"] for name, value in paired["results"].items()},
              "runtime": runtime_versions(), "approved_for_production": False,
              "timing_excludes_cached_model": cache_report is not None,
              "limitations": "Presets ranked only on new synthetic development pages. Actual construction sheets remain qualitative probes; no protected holdout tuning."}
    write_json(args.output / "report.json", result)
    print(json.dumps({"ranking": ranking, "summary": {name: value["summary"] for name, value in results.items()}}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True); parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--paired-report", type=Path, required=True); parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--probability-cache", type=Path)
    parser.add_argument("--overlap", type=int, default=128); parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--device", choices=["cuda", "cpu"], default="cuda"); args = parser.parse_args()
    if args.threads < 1:
        parser.error("Thread count must be positive")
    os.umask(0o077); run(args)
