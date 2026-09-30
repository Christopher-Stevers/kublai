"""Qualitative native-sheet probe for a fixed development-scored ROI hypothesis."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import time

import numpy as np
from PIL import Image

from common import file_hash, private_dir, source_hashes, write_json
from context_predict import verify_hashes
from roi_challenger import PRESETS, VERSION, bounded_rooms
from roi_evaluate import INFERENCE_FILES


def run(args):
    sources = source_hashes()
    json_path = args.context_prediction / "prediction.json"
    probability_path = args.context_prediction / "probabilities.npz"
    frozen = {path: file_hash(path) for path in (args.image, args.development_report, json_path, probability_path)}
    reference = json.loads(args.development_report.read_text())
    context = json.loads(json_path.read_text())
    if reference.get("version") != VERSION or args.preset not in reference["results"] or reference["presets"] != PRESETS:
        raise ValueError("This declared preset needs a completed exact development table")
    if context["checkpoint_sha256"] != reference["checkpoint_sha256"] or context["input_sha256"] != frozen[args.image]:
        raise ValueError("Actual context probe belongs to a different checkpoint/input")
    for name in INFERENCE_FILES:
        if context["source_hashes"].get(name) != sources[name] or reference["source_hashes"].get(name) != sources[name]:
            raise ValueError("Inference/polygonizer differs from the frozen development probe")
    if reference["source_hashes"].get("roi_challenger.py") != sources["roi_challenger.py"]:
        raise ValueError("ROI experiment changed since development ranking")
    with Image.open(args.image) as image:
        width, height = image.size
    if width * height > 30_000_000 or context["width"] != width or context["height"] != height:
        raise ValueError("Invalid bounded native-sheet dimensions")
    with np.load(probability_path) as arrays:
        probability = arrays["probability"].copy()
        overview = arrays["overview_interior"].copy()
    if probability.shape != (3, height, width) or overview.shape != (height, width):
        raise ValueError("Actual cached probabilities have incompatible dimensions")
    verify_hashes(frozen)
    started = time.monotonic()
    labels, rooms, diagnostics = bounded_rooms(probability, args.preset)
    private_dir(args.output)
    labels.astype("<i4").tofile(args.output / "labels.i32")
    np.savez_compressed(args.output / "probabilities.npz", probability=probability, overview_interior=overview)
    verify_hashes(frozen)
    if source_hashes() != sources:
        raise RuntimeError("Sources changed during actual-sheet probe")
    result = {"version": VERSION, "width": width, "height": height, "rooms": rooms,
              "input_sha256": frozen[args.image], "checkpoint_sha256": context["checkpoint_sha256"],
              "context_prediction_sha256": frozen[json_path], "context_probability_sha256": frozen[probability_path],
              "development_report_sha256": frozen[args.development_report], "source_hashes": sources,
              "preset": args.preset, "parameters": PRESETS[args.preset], "diagnostics": diagnostics,
              "artifact_sha256": {name: file_hash(args.output / name) for name in ("labels.i32", "probabilities.npz")},
              "wall_seconds": time.monotonic() - started, "approved_for_production": False,
              "limitations": "Qualitative actual-sheet probe after fixed development scoring. No complete real-floor reference exists; no precision/recall claim. Probability bytes are recorded at read time from the preserved private context run."}
    write_json(args.output / "prediction.json", result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("image", "context-prediction", "development-report", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--preset", choices=list(PRESETS), required=True)
    args = parser.parse_args()
    os.umask(0o077)
    result = run(args)
    print(json.dumps({"rooms": len(result["rooms"]), "preset": args.preset, "wall_seconds": result["wall_seconds"]}))
