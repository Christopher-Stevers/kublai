"""Freeze/replay cached long48 maps on original development pages only."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import time

import numpy as np
import scipy
import shapely
import skimage

from partition import FIXED, PRESETS, VERSION, partition_rooms

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
sys.path.insert(0, str(REPO / "scripts/rooms/bench"))
from metrics import aggregate, score
sys.path.insert(0, str(REPO / "scripts/rooms/complete"))
from report_completeness import completeness_metrics

# This bounded replay deliberately cannot accept the exposed once-only corpus,
# old protected geometric corpus or another checkpoint/development dataset.
ALLOWED_MANIFEST = "79c22af5e8b2faeac31c6b8b290d292dccc5d9c34db542474edaa79b951a4cac"
ALLOWED_CHECKPOINT = "aaa9990485a71a93406bf84ed21871f20721b0981c069247928c379633dd8313"
ALLOWED_DEVELOPMENT = "cac68bd373761d21faaa8c7a2a7c7d2ee70ee7a6ef1db4ea64593d478e7a31f3"
ALLOWED_ACTUAL_IMAGE = "0047f9a9c46b0a5e8770be18a7fbaefd1dd80496d3c24fa09cd233ea0a591828"
# Independently recorded by the earlier immutable normal/bounded ROI probes.
ALLOWED_ACTUAL_PREDICTION = "c4b05c1ae6f084ca9e679c17a0bf9e3ddd8285238de6618f963bbc20d4937d02"
ALLOWED_ACTUAL_PROBABILITY = "0d486d09885b269a5e4571c7be280a393a0dfa5e50ed5acf19a939521ea2610a"
INFERENCE_FILES = ("common.py", "network.py", "context_network.py", "context_predict.py", "predict.py")


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def sources():
    files = sorted(ROOT.glob("*.py")) + [ROOT / "requirements.txt",
              REPO / "scripts/rooms/bench/metrics.py", REPO / "scripts/rooms/complete/report_completeness.py"]
    return {str(p.relative_to(REPO)): digest(p) for p in files if not p.name.startswith("test_")}


def verify(binding, historical_support=False):
    current = sources()
    if binding["presets"] != PRESETS or binding["fixed"] != FIXED:
        raise RuntimeError("Frozen partition sources/settings changed")
    if historical_support:
        # Support-only reader/probe repairs can read an already completed run.
        # They cannot substitute a different partitioner or metrics dependency.
        snapshot = Path(binding["binding_path"]).parent / "frozen_sources"
        for name, expected in binding["source_hashes"].items():
            if digest(snapshot / name) != expected:
                raise RuntimeError("Historical scoring source snapshot changed")
            if name not in ("scripts/rooms/partition/evaluate.py", "scripts/rooms/partition/probe.py") and current.get(name) != expected:
                raise RuntimeError("Partition/metric source changed since development scoring")
    elif binding["source_hashes"] != current:
        raise RuntimeError("Frozen partition sources/settings changed")
    for path, expected in binding["input_hashes"].items():
        if digest(path) != expected:
            raise ValueError("Frozen input changed: " + str(path))


def write(path, value):
    with Path(path).open("x") as handle:
        json.dump(value, handle, indent=2, allow_nan=False)
    Path(path).chmod(0o600)


def asset(root, name, expected):
    root = root.resolve()
    if not isinstance(name, str) or Path(name).is_absolute():
        raise ValueError("Local relative assets are required")
    result = (root / name).resolve(strict=True)
    if not result.is_relative_to(root) or not result.is_file() or digest(result) != expected:
        raise ValueError("Asset escape/hash mismatch")
    return result


def pinned_json(path, expected):
    raw = Path(path).read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected or digest(path) != expected:
        raise ValueError("Input metadata hash differs")
    return json.loads(raw)


def freeze(args):
    manifest = pinned_json(args.manifest, ALLOWED_MANIFEST)
    reference = pinned_json(args.development_report, ALLOWED_DEVELOPMENT)
    if digest(args.checkpoint) != ALLOWED_CHECKPOINT:
        raise ValueError("Only frozen long48 weights are permitted")
    if reference["manifest_sha256"] != ALLOWED_MANIFEST or reference["checkpoint_sha256"] != ALLOWED_CHECKPOINT:
        raise ValueError("Historical probability provenance differs")
    case_ids = set(reference["ids"])
    records = [r for r in manifest["records"] if r["id"] in case_ids]
    if len(case_ids) != 20 or len(records) != 20 or any(r["source"] != "synthetic-msd" or r["split"] != "validation" for r in records):
        raise ValueError("Only all original 20 complete development pages are permitted")
    if case_ids != {r["id"] for r in manifest["records"] if r["split"] == "validation"}:
        raise ValueError("Reference does not cover the original development split")
    frozen = {str(p.resolve()): digest(p) for p in (args.manifest, args.development_report, args.checkpoint)}
    baseline = {r["id"]: r for r in reference["results"]["baseline_low_barrier"]["cases"]}
    cases = []
    for record in records:
        image = asset(args.manifest.parent, record["image"], record["image_sha256"])
        target = asset(args.manifest.parent, record["targets"], record["targets_sha256"])
        probability = asset(args.cache, record["id"] + ".probabilities.npz", baseline[record["id"]]["probabilities_sha256"])
        for path in (image, target, probability):
            frozen[str(path)] = digest(path)
        cases.append({"id": record["id"], "group": record["group"], "image": str(image),
                      "targets": str(target), "probabilities": str(probability)})
    historical_inference = {}
    for name in INFERENCE_FILES:
        path = REPO / "scripts/rooms/models" / name
        if digest(path) != reference["source_hashes"][name]:
            raise ValueError("Historical learned inference dependency differs")
        frozen[str(path)] = digest(path)
        historical_inference[name] = digest(path)
    actual_prediction = args.actual_prediction / "prediction.json"
    actual = pinned_json(actual_prediction, ALLOWED_ACTUAL_PREDICTION)
    if (digest(args.actual_image) != ALLOWED_ACTUAL_IMAGE or actual["input_sha256"] != ALLOWED_ACTUAL_IMAGE
            or actual["checkpoint_sha256"] != ALLOWED_CHECKPOINT or actual["training_manifest_sha256"] != ALLOWED_MANIFEST
            or any(actual["source_hashes"].get(name) != value for name, value in historical_inference.items())):
        raise ValueError("Actual probe must use the clean RGB image and frozen long48 maps")
    actual_cache = args.actual_prediction / "probabilities.npz"
    if digest(actual_cache) != ALLOWED_ACTUAL_PROBABILITY:
        raise ValueError("Actual probabilities differ from independently recorded prior ROI provenance")
    for path in (args.actual_image, actual_prediction, actual_cache):
        frozen[str(path.resolve())] = digest(path)
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    snapshot = args.output / "frozen_sources"
    snapshot.mkdir(mode=0o700)
    current = sources()
    for name in current:
        out = snapshot / name
        out.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        shutil.copyfile(REPO / name, out)
        out.chmod(0o600)
    write(snapshot / "CHECKSUMS.json", current)
    result = {"version": VERSION, "binding_path": str((args.output / "binding.json").resolve()),
              "manifest_sha256": ALLOWED_MANIFEST, "checkpoint_sha256": ALLOWED_CHECKPOINT,
              "development_report_sha256": ALLOWED_DEVELOPMENT, "historical_inference_hashes": historical_inference,
              "input_hashes": frozen, "source_hashes": current, "presets": PRESETS, "fixed": FIXED,
              "cases": cases, "baseline": reference["results"]["baseline_low_barrier"],
              "actual": {"image": str(args.actual_image.resolve()), "probabilities": str(actual_cache.resolve()),
                         "prediction": str(actual_prediction.resolve()), "width": actual["width"], "height": actual["height"]},
              "approved_for_production": False,
              "limitations": "Exactly three declared development settings; no GT seeds/counts/crops. No new-site/protected corpus access."}
    verify(result)
    write(args.output / "binding.json", result)
    return result


def validate_binding_metadata(binding):
    def input_path(expected):
        paths = [Path(name) for name, value in binding["input_hashes"].items() if value == expected]
        if len(paths) != 1:
            raise ValueError("Required original input identity missing or duplicated")
        return paths[0]

    if (binding.get("version") != VERSION or binding.get("manifest_sha256") != ALLOWED_MANIFEST
            or binding.get("checkpoint_sha256") != ALLOWED_CHECKPOINT
            or binding.get("development_report_sha256") != ALLOWED_DEVELOPMENT):
        raise ValueError("Only the original bound development/checkpoint identities are allowed")
    manifest_path, report_path = input_path(ALLOWED_MANIFEST), input_path(ALLOWED_DEVELOPMENT)
    input_path(ALLOWED_CHECKPOINT)
    manifest = pinned_json(manifest_path, ALLOWED_MANIFEST)
    report = pinned_json(report_path, ALLOWED_DEVELOPMENT)
    records = {row["id"]: row for row in manifest["records"] if row["split"] == "validation"}
    cases = binding["cases"]
    if len(records) != 20 or len(cases) != 20 or {row["id"] for row in cases} != set(records):
        raise ValueError("Binding must cover exactly the unique original 20 development IDs")
    cache_rows = {row["id"]: row for row in report["results"]["baseline_low_barrier"]["cases"]}
    if binding["baseline"] != report["results"]["baseline_low_barrier"]:
        raise ValueError("Historical baseline differs from the original completed report")
    for case in cases:
        record = records[case["id"]]
        if record["source"] != "synthetic-msd" or case["group"] != record["group"]:
            raise ValueError("Original development group/source differs")
        for key in ("image", "targets"):
            if (Path(case[key]).resolve() != (manifest_path.parent / record[key]).resolve()
                    or binding["input_hashes"].get(case[key]) != record[key + "_sha256"]):
                raise ValueError("Development image/reference identity differs")
        if binding["input_hashes"].get(case["probabilities"]) != cache_rows[case["id"]]["probabilities_sha256"]:
            raise ValueError("Cached development maps differ from original report provenance")
    actual = binding["actual"]
    for name, expected in (("image", ALLOWED_ACTUAL_IMAGE), ("prediction", ALLOWED_ACTUAL_PREDICTION),
                           ("probabilities", ALLOWED_ACTUAL_PROBABILITY)):
        if binding["input_hashes"].get(actual[name]) != expected:
            raise ValueError("Actual evidence differs from independently recorded source/map provenance")


def read_binding(path, historical_support=False):
    before = digest(path)
    binding = pinned_json(path, before)
    if path.resolve() != Path(binding["binding_path"]):
        raise ValueError("Use the original frozen binding")
    validate_binding_metadata(binding)
    verify(binding, historical_support)
    return binding, before


def checked_probabilities(path, expected):
    if digest(path) != expected:
        raise ValueError("Cached probability bytes changed")
    with np.load(path, allow_pickle=False) as arrays:
        probability = arrays["probability"].copy()
    if digest(path) != expected:
        raise ValueError("Cached probability changed during decoding")
    return probability


def versions():
    return {"python": sys.version.split()[0], "numpy": np.__version__, "scipy": scipy.__version__,
            "shapely": shapely.__version__, "scikit_image": skimage.__version__, "device": "cpu"}


def evaluate(args):
    binding, binding_hash = read_binding(args.binding)
    marker = args.binding.parent / "SCORING_STARTED"
    descriptor = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        handle.write(binding_hash + "\n")
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    methods = {preset: [] for preset in PRESETS}
    for case in binding["cases"]:
        verify(binding)
        path = Path(case["probabilities"])
        probability = checked_probabilities(path, binding["input_hashes"][str(path)])
        # No reference is decoded until every declared prediction is finished.
        predictions = {}
        for preset in PRESETS:
            started = time.monotonic()
            try:
                labels, rooms, diagnostics = partition_rooms(probability, preset)
                status, error = "ok", None
                labels.astype("<i4").tofile(args.output / f"{case['id']}-{preset}.labels.i32")
                write(args.output / f"{case['id']}-{preset}.rooms.json", rooms)
            except (ValueError, RuntimeError) as exc:
                labels, rooms, diagnostics = np.zeros(probability.shape[1:], dtype=np.int32), [], {}
                status, error = "failed", str(exc)
            predictions[preset] = (labels, len(rooms), diagnostics, status, error, (time.monotonic() - started) * 1000)
        target = Path(case["targets"])
        if digest(target) != binding["input_hashes"][str(target)]:
            raise ValueError("Target bytes changed before decoding")
        with np.load(target, allow_pickle=False) as arrays:
            truth, known = arrays["truth"].copy(), arrays["known"].copy()
        verify(binding)
        if not np.all(known == 1) or truth.shape != probability.shape[1:]:
            raise ValueError("Complete aligned synthetic targets are required")
        for preset, (labels, n, diagnostics, status, error, elapsed) in predictions.items():
            methods[preset].append({"id": case["id"], "group": case["group"], "status": status, "error": error,
                                    "metrics": score(truth, labels), "exported_polygons": n, "diagnostics": diagnostics,
                                    "timing": {"wall_ms": elapsed}})
        print(json.dumps({"completed": len(methods[next(iter(PRESETS))]), "total": len(binding["cases"])}), flush=True)
    result = {name: {"cases": rows, "summary": aggregate(rows), "completeness": completeness_metrics(rows)}
              for name, rows in methods.items()}
    result["historical_normal_barrier_04"] = binding["baseline"]
    verify(binding)
    if digest(args.binding) != binding_hash:
        raise RuntimeError("Binding mutated during scoring")
    report = {"version": VERSION, "binding_path": str(args.binding.resolve()), "binding_sha256": binding_hash,
              "input_hashes": binding["input_hashes"], "source_hashes": binding["source_hashes"],
              "presets": PRESETS, "fixed": FIXED, "results": result, "runtime": versions(),
              "approved_for_production": False,
              "limitations": "Development postprocessing only; cached learned maps and historical baseline. No inference/training speed claimed. Ground truth cannot enter markers. Not real-sheet accuracy."}
    write(args.output / "report.json", report)
    return report


def rank(report):
    def order(name):
        group = report["results"][name]
        summary = group["summary"]
        return (-group["completeness"]["thresholds"]["50"]["floors_with_zero_missed_spaces"],
                summary["failures"], summary["fn50"], summary["fp50"], summary["merge_candidates"], summary["split_candidates"])
    return min(PRESETS, key=order)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("freeze")
    for name in ("manifest", "checkpoint", "development-report", "cache", "actual-image", "actual-prediction", "output"):
        build.add_argument("--" + name, type=Path, required=True)
    run = sub.add_parser("evaluate")
    run.add_argument("--binding", type=Path, required=True)
    run.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    result = freeze(args) if args.command == "freeze" else evaluate(args)
    print(json.dumps({"settings": list(PRESETS), "cases": len(result["cases"]) if args.command == "freeze" else
                     len(result["results"][next(iter(PRESETS))]["cases"])}))


if __name__ == "__main__":
    main()
