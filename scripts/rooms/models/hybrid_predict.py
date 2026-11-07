"""Qualitative private probe using the preset ranked on new development data."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import time

import numpy as np
from PIL import Image

from common import file_hash, private_dir, source_hashes, write_json
from context_predict import runtime_versions, verify_hashes
from hybrid_native import VERSION, native_probabilities
from predict import global_rooms


def run(args):
    files = [args.image, args.ranking_report, args.context_prediction / "prediction.json",
             args.context_prediction / "probabilities.npz"]
    frozen = {path: file_hash(path) for path in files}
    sources = source_hashes()
    context = json.loads(files[2].read_text())
    ranking = json.loads(args.ranking_report.read_text())
    if ranking["version"] != VERSION or ranking["checkpoint_sha256"] != context["checkpoint_sha256"]:
        raise ValueError("Use a ranking produced by this context checkpoint")
    if ranking["source_hashes"]["hybrid_native.py"] != sources["hybrid_native.py"]:
        raise ValueError("Native challenger source changed after preset ranking")
    if context["input_sha256"] != frozen[args.image]:
        raise ValueError("Cached context input differs from this source image")
    preset = ranking["ranking"][0]
    with Image.open(args.image) as source:
        if source.width * source.height > 30_000_000:
            raise ValueError("Input exceeds bounded 30-megapixel adapter")
        image = np.asarray(source.convert("RGB"), dtype=np.float32) / 255
    with np.load(files[3]) as arrays:
        probability = arrays["probability"].copy()
        overview = arrays["overview_interior"].copy() if "overview_interior" in arrays else None
    if probability.shape != (3, *image.shape[:2]) or image.shape[1::-1] != (context["width"], context["height"]):
        raise ValueError("Cached model/source dimensions differ")
    verify_hashes(frozen)
    private_dir(args.output)
    started = time.monotonic()
    probability, diagnostics = native_probabilities(image, probability, preset)
    labels, rooms = global_rooms(probability)
    for room in rooms:
        room["detection"].update(version=VERSION, basis="native-wall-context-challenger")
    labels.astype("<i4").tofile(args.output / "labels.i32")
    np.savez_compressed(args.output / "probabilities.npz", probability=probability,
                        **({"overview_interior": overview} if overview is not None else {}))
    verify_hashes(frozen)
    if source_hashes() != sources:
        raise RuntimeError("Source changed during actual-sheet probe")
    result = {"version": VERSION, "width": image.shape[1], "height": image.shape[0], "rooms": rooms,
              "input_sha256": frozen[args.image], "checkpoint_sha256": context["checkpoint_sha256"],
              "context_prediction_sha256": frozen[files[2]], "context_probabilities_sha256": frozen[files[3]],
              "ranking_report_sha256": frozen[args.ranking_report], "source_hashes": sources,
              "diagnostics": diagnostics, "runtime": runtime_versions(),
              "wall_seconds_excluding_cached_model": time.monotonic() - started,
              "approved_for_production": False,
              "limitations": "Development-ranked native-wall challenger, not approved. Cached model probabilities are reused; actual-sheet room recall is unknown without complete reviewed reference."}
    write_json(args.output / "prediction.json", result)
    print(json.dumps({"preset": preset, "rooms": len(rooms), "diagnostics": diagnostics}))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True); parser.add_argument("--context-prediction", type=Path, required=True)
    parser.add_argument("--ranking-report", type=Path, required=True); parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(); os.umask(0o077); run(args)
