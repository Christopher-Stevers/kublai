"""Fixed small ROI/threshold/core tradeoff table on frozen development pages."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import time

import numpy as np
from PIL import Image
from scipy import ndimage
import torch

from common import REPO, checked_asset, file_hash, private_dir, source_hashes, write_json
from context_predict import context_probabilities, load_context_model, runtime_versions, verify_hashes
from context_train import read_context_manifest
from roi_challenger import PRESETS, VERSION, bounded_rooms

sys.path.insert(0, str(REPO / "scripts/rooms/bench"))
from metrics import aggregate, match_at, score
sys.path.insert(0, str(REPO / "scripts/rooms/complete"))
from report_completeness import completeness_metrics

INFERENCE_FILES = ("common.py", "network.py", "context_network.py", "context_predict.py", "predict.py")
COMPLETENESS_SOURCE = REPO / "scripts/rooms/complete/report_completeness.py"


def missing_reasons(truth, prediction, probability):
    """Mutually exclusive descriptive associations, not causal attribution."""
    tids, gt = np.unique(truth.ravel(), return_inverse=True)
    pids, pr = np.unique(prediction.ravel(), return_inverse=True)
    table = np.bincount(gt * len(pids) + pr, minlength=len(tids) * len(pids)).reshape(len(tids), len(pids))
    actual, proposed = tids != 0, pids != 0
    gt_area = table.sum(axis=1)[actual].astype(float)
    intersections = table[np.ix_(actual, proposed)].astype(float)
    union = gt_area[:, None] + table.sum(axis=0)[proposed][None] - intersections
    iou = np.divide(intersections, union, out=np.zeros_like(intersections), where=union > 0)
    unmatched = set(range(len(gt_area))) - set(match_at(iou, 0.5).values())
    coverage = np.divide(intersections, gt_area[:, None], out=np.zeros_like(intersections), where=gt_area[:, None] > 0)
    merging = np.sum(coverage >= 0.5, axis=0) >= 2
    raw, count = ndimage.label(np.maximum(probability[1], probability[2]) < 0.5)
    raw_table = np.bincount(gt * (count + 1) + raw.ravel(), minlength=len(tids) * (count + 1)).reshape(len(tids), count + 1)[actual]
    areas = np.bincount(raw.ravel(), minlength=count + 1)
    occupancy = np.bincount(raw.ravel(), weights=probability[0].ravel(), minlength=count + 1)
    border = set(np.concatenate([raw[0], raw[-1], raw[:, 0], raw[:, -1]]))
    reasons = {name: 0 for name in ("retained_merge_associated", "raw_border_rejection", "raw_small_rejection",
                                   "raw_weak_interior_rejection", "boundary_or_fragment_mismatch")}
    details = []
    for i in sorted(unmatched):
        dominant = int(raw_table[i].argmax())
        dominant_fraction = float(raw_table[i, dominant] / gt_area[i])
        if len(pids[proposed]) and np.any((coverage[i] >= 0.5) & merging):
            reason = "retained_merge_associated"
        elif dominant_fraction >= 0.5 and dominant in border and dominant != 0:
            reason = "raw_border_rejection"
        elif dominant_fraction >= 0.5 and dominant != 0 and areas[dominant] < 25:
            reason = "raw_small_rejection"
        elif dominant_fraction >= 0.5 and dominant != 0 and occupancy[dominant] / areas[dominant] < 0.35:
            reason = "raw_weak_interior_rejection"
        else:
            reason = "boundary_or_fragment_mismatch"
        reasons[reason] += 1
        details.append({"truth_id": int(tids[actual][i]), "area_pixels": int(gt_area[i]), "association": reason,
                        "dominant_raw_component_coverage": dominant_fraction})
    return {"counts": reasons, "unmatched_spaces": details,
            "limitations": "Associations at the fixed baseline thresholds; a low-IoU boundary mismatch need not be a literal missing space."}


def run(args):
    sources = source_hashes()
    frozen = {path: file_hash(path) for path in (args.manifest, args.checkpoint, args.paired_report, COMPLETENESS_SOURCE)}
    paired = json.loads(args.paired_report.read_text())
    if paired["manifest_sha256"] != frozen[args.manifest] or paired["checkpoint_sha256"] != frozen[args.checkpoint]:
        raise ValueError("Use an exact completed development reference for this checkpoint/data")
    if paired["thresholds"] != {"boundary": 0.5, "interior": 0.35} or paired["tiling"]["overlap"] != 128:
        raise ValueError("The reference must use the declared fixed baseline")
    if any(sources[name] != paired["source_hashes"].get(name) for name in INFERENCE_FILES):
        raise ValueError("Inference/polygonizer changed since the paired reference")
    manifest = read_context_manifest(args.manifest)
    ids = set(paired["ids"])
    cases = [r for r in manifest["records"] if r["id"] in ids]
    if len(cases) != len(ids) or any(r["split"] != "validation" or r["source"] != "synthetic-msd" for r in cases):
        raise ValueError("This bounded experiment requires the same complete synthetic development cases")
    torch.set_num_threads(args.threads)
    device = torch.device(args.device)
    model, metadata = load_context_model(args.checkpoint, device)
    if metadata["manifest_sha256"] != frozen[args.manifest]:
        raise ValueError("Checkpoint belongs to a different manifest")
    private_dir(args.output)
    methods = {preset: [] for preset in PRESETS}
    missed = []
    for case in cases:
        if source_hashes() != sources:
            raise RuntimeError("ROI sources changed during development scoring")
        image_path = checked_asset(args.manifest.parent, case["image"], case["image_sha256"])
        targets_path = checked_asset(args.manifest.parent, case["targets"], case["targets_sha256"])
        frozen[image_path], frozen[targets_path] = case["image_sha256"], case["targets_sha256"]
        with Image.open(image_path) as source:
            image = np.asarray(source.convert("RGB"), dtype=np.float32) / 255
        with np.load(targets_path) as arrays:
            truth = arrays["truth"].copy()
        verify_hashes({image_path: case["image_sha256"], targets_path: case["targets_sha256"]})
        probability, _ = context_probabilities(model, image, metadata["tile"], 128, metadata["overview"], device)
        cache = args.output / f"{case['id']}.probabilities.npz"
        np.savez_compressed(cache, probability=probability)
        cache.chmod(0o600)
        for preset in PRESETS:
            started = time.monotonic()
            labels, rooms, diagnostics = bounded_rooms(probability, preset)
            row = {"id": case["id"], "group": case["group"], "status": "ok", "metrics": score(truth, labels),
                   "diagnostics": diagnostics, "exported_polygons": len(rooms), "probabilities_sha256": file_hash(cache),
                   "timing": {"wall_ms": (time.monotonic() - started) * 1000}}
            methods[preset].append(row)
            if preset == "baseline":
                missed.append({"id": case["id"], **missing_reasons(truth, labels, probability)})
        print(json.dumps({"development": len(missed), "total": len(cases)}), flush=True)
    summaries = {name: {"cases": rows, "summary": aggregate(rows), "completeness": completeness_metrics(rows)}
                 for name, rows in methods.items()}
    counts = ("expected", "predicted", "tp50", "fp50", "fn50", "tp75", "fp75", "fn75", "merge_candidates", "split_candidates")
    if any(summaries["baseline"]["summary"][key] != paired["results"]["context"]["summary"][key] for key in counts):
        raise RuntimeError("Replayed baseline differs; do not attribute a gain to postprocessing")
    verify_hashes(frozen)
    if source_hashes() != sources:
        raise RuntimeError("ROI sources changed before report save")
    report = {"version": VERSION, "split": "fixed-whole-sheet-model-development", "ids": [r["id"] for r in cases],
              "manifest_sha256": frozen[args.manifest], "checkpoint_sha256": frozen[args.checkpoint],
              "paired_report_sha256": frozen[args.paired_report], "source_hashes": sources,
              "completeness_source_sha256": frozen[COMPLETENESS_SOURCE], "presets": PRESETS,
              "results": summaries, "baseline_missing_diagnostics": missed,
              "baseline_missing_counts": {name: sum(row["counts"][name] for row in missed) for name in missed[0]["counts"]},
              "runtime": runtime_versions(), "approved_for_production": False,
              "limitations": "Six predeclared development hypotheses, not a broad threshold search. ROI may create unsupported outer contours; area/core gates can lose real small rooms. Postprocessing time excludes inference. No protected holdout or untouched sites read."}
    write_json(args.output / "report.json", report)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("manifest", "checkpoint", "paired-report", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cuda")
    args = parser.parse_args()
    if args.threads < 1:
        parser.error("Positive thread count required")
    os.umask(0o077)
    result = run(args)
    print(json.dumps({"summary": {name: value["summary"] for name, value in result["results"].items()},
                      "baseline_missing_counts": result["baseline_missing_counts"]}))
