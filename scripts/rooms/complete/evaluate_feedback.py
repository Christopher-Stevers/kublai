"""Private, reproducible room-review evaluation. Never reads a DB or provider key."""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
from importlib.metadata import version
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import time
from typing import Any

import numpy as np
from PIL import Image
from shapely.geometry import Polygon

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bench"))
from metrics import aggregate, match_at  # noqa: E402

CONTRACT = "reviewed-polygon-iou-v1"
MAX_ROOMS = 2000


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def job_split(job: str) -> str:
    return "holdout" if int(hashlib.sha256(job.encode()).hexdigest()[:8], 16) % 5 == 0 else "development"


def private_file(root: Path, asset: dict[str, Any]) -> Path:
    """Reject missing bytes, path traversal, external symlinks, and changed snapshots."""
    name, expected = asset.get("path"), asset.get("sha256")
    if not isinstance(name, str) or Path(name).is_absolute():
        raise ValueError("Snapshot asset must have a relative local path")
    if not isinstance(expected, str) or not re.fullmatch(r"[a-f0-9]{64}", expected):
        raise ValueError("Snapshot asset must include its SHA-256")
    path = (root / name).resolve(strict=True)
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError("Snapshot asset escapes the private export")
    if file_hash(path) != expected:
        raise ValueError(f"Snapshot asset hash changed: {name}")
    return path


def shape_polygon(shape: dict[str, Any]) -> Polygon:
    """Keep holes and use normalized original-page coordinates, without repairing GT."""
    if shape.get("type") == "bbox":
        x, y, w, h = (shape[k] for k in ("x", "y", "w", "h"))
        points = [{"x": x, "y": y}, {"x": x + w, "y": y},
                  {"x": x + w, "y": y + h}, {"x": x, "y": y + h}]
        holes = []
    elif shape.get("type") == "polygon":
        points, holes = shape.get("points"), shape.get("holes", [])
    else:
        raise ValueError("Expected an explicit polygon or bounding box")

    def ring(items: Any) -> list[tuple[float, float]]:
        if not isinstance(items, list) or len(items) < 3 or len(items) > 20000:
            raise ValueError("Invalid polygon ring")
        coordinates = [(p["x"], p["y"]) for p in items]
        if any(not isinstance(v, (int, float)) or isinstance(v, bool) or
               not math.isfinite(v) or not 0 <= v <= 1 for point in coordinates for v in point):
            raise ValueError("Polygon points must be finite normalized page coordinates")
        return coordinates

    if not isinstance(holes, list) or len(holes) > 100:
        raise ValueError("Invalid polygon holes")
    polygon = Polygon(ring(points), [ring(hole) for hole in holes])
    if polygon.is_empty or not polygon.is_valid or polygon.area <= 0:
        raise ValueError("Invalid or empty room polygon; repair the review before scoring")
    return polygon


def overlap_matrix(truth: list[Polygon], prediction: list[Polygon]) -> tuple[np.ndarray, np.ndarray]:
    if max(len(truth), len(prediction)) > MAX_ROOMS:
        raise ValueError("Too many instances for bounded evaluation")
    intersection = np.zeros((len(truth), len(prediction)), dtype=float)
    for i, expected in enumerate(truth):
        a = expected.bounds
        for j, candidate in enumerate(prediction):
            b = candidate.bounds
            if a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]:
                intersection[i, j] = expected.intersection(candidate).area
    garea = np.asarray([p.area for p in truth])[:, None]
    parea = np.asarray([p.area for p in prediction])[None, :]
    union = garea + parea - intersection
    ious = np.divide(intersection, union, out=np.zeros_like(intersection), where=union > 0)
    coverage = np.divide(intersection, garea, out=np.zeros_like(intersection), where=garea > 0)
    return ious, coverage


def full_metrics(truth: list[Polygon], prediction: list[Polygon]) -> dict[str, Any]:
    """Same one-to-one matching thresholds as MSD metrics, on saved vector outlines."""
    ious, coverage = overlap_matrix(truth, prediction)
    n, m = len(truth), len(prediction)
    result: dict[str, Any] = {"expected": n, "predicted": m}
    for threshold, suffix in ((0.5, "50"), (0.75, "75")):
        matches = match_at(ious, threshold)
        tp = len(matches)
        result.update({f"tp{suffix}": tp, f"fp{suffix}": m - tp, f"fn{suffix}": n - tp,
                       f"precision{suffix}": tp / m if m else (1.0 if not n else 0.0),
                       f"recall{suffix}": tp / n if n else 1.0,
                       f"f1_{suffix}": 2 * tp / (n + m) if n + m else 1.0})
        if suffix == "50":
            total = sum(float(ious[i, j]) for j, i in matches.items())
            result.update(matched_iou_sum=total, mean_iou_all_gt=total / n if n else 1.0)
    result["merge_candidates"] = int(np.sum(np.sum(coverage >= 0.5, axis=0) >= 2))
    result["split_candidates"] = int(np.sum((np.sum(coverage >= 0.15, axis=1) >= 2) & (coverage.sum(axis=1) >= 0.5)))
    return result


def partial_evidence(approved: list[Polygon], rejected: list[Polygon], prediction: list[Polygon]) -> dict[str, Any]:
    """Unreviewed spaces are unknown: there is deliberately no global recall or FP."""
    positive_ious, _ = overlap_matrix(approved, prediction)
    negative_ious, _ = overlap_matrix(rejected, prediction)
    matched = match_at(positive_ious, 0.5)
    reemitted = negative_ious >= 0.65
    return {"reviewed_positive_count": len(approved), "recovered_reviewed_positive50": len(matched),
            "missed_reviewed_positive50": len(approved) - len(matched),
            "reviewed_positive_iou_sum": sum(float(positive_ious[i, j]) for j, i in matched.items()),
            "reviewed_rejection_count": len(rejected),
            "reviewed_rejected_proposals_reemitted65": int(np.sum(reemitted.any(axis=1))),
            "candidates_matching_reviewed_rejections65": int(np.sum(reemitted.any(axis=0)))}


def complete_floor(floor: dict[str, Any]) -> bool:
    reviewed_hash, source = floor.get("sourceReviewHash"), floor.get("sourceDrawing")
    if not (floor.get("completenessReviewed") is True and floor.get("floorStatus") == "confirmed" and
            isinstance(floor.get("reviewCompletenessProvenance"), str) and floor["reviewCompletenessProvenance"] and
            isinstance(reviewed_hash, str) and re.fullmatch(r"[a-f0-9]{64}", reviewed_hash) and
            isinstance(source, dict) and source.get("sha256") == reviewed_hash):
        return False
    try:
        reviewed = datetime.fromisoformat(floor["completenessReviewedAt"].replace("Z", "+00:00"))
        confirmed = datetime.fromisoformat(floor["floorConfirmedAt"].replace("Z", "+00:00"))
        return reviewed.tzinfo is not None and confirmed.tzinfo is not None and reviewed <= confirmed
    except (KeyError, AttributeError, TypeError, ValueError):
        return False


def validate_export(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]], int]:
    if payload.get("version") != 2 or payload.get("target") != "physical-spaces":
        raise ValueError("Use the immutable version-2 physical-spaces export")
    floors, examples = payload.get("floors"), payload.get("examples")
    if not isinstance(floors, list) or not isinstance(examples, list):
        raise ValueError("Export requires floors and reviewed examples")
    indexed: dict[str, dict[str, Any]] = {}
    groups: dict[str, str] = {}
    for floor in floors:
        ident, job = floor.get("floorId"), floor.get("jobId")
        if not isinstance(ident, str) or not isinstance(job, str) or ident in indexed:
            raise ValueError("Floor IDs must be unique and job IDs explicit")
        if floor.get("group") != job or floor.get("split") != job_split(job):
            raise ValueError("Every job must use its deterministic grouped split")
        if groups.setdefault(job, floor["split"]) != floor["split"]:
            raise ValueError("One job cannot appear in both development and holdout")
        if not floor.get("drawingKey") or not isinstance(floor.get("approvedRooms"), list):
            raise ValueError("Each floor needs a drawing key and approved room snapshot")
        ids = [r["id"] for r in floor["approvedRooms"]]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate approved room in floor snapshot")
        for room in floor["approvedRooms"]:
            shape_polygon(room["shape"])
        indexed[ident] = floor
    current: dict[str, list[dict[str, Any]]] = {ident: [] for ident in indexed}
    seen: set[str] = set()
    stale = 0
    for example in examples:
        ident = example.get("id")
        if not isinstance(ident, str) or ident in seen:
            raise ValueError("Export must contain only one current decision per room")
        seen.add(ident)
        floor = indexed.get(example.get("floorId"))
        if floor is None or example.get("drawingKey") != floor["drawingKey"]:
            stale += 1
            continue
        if example.get("group") != floor["jobId"] or example.get("split") != floor["split"]:
            raise ValueError("Reviewed example crosses the job split")
        if example.get("sourceVerified") is not True:
            raise ValueError("Only source-verified reviews can establish geometric accuracy")
        detection = example.get("detection")
        recorded_hash = detection.get("drawingHash") if isinstance(detection, dict) else None
        source = floor.get("sourceDrawing")
        if not isinstance(recorded_hash, str) or not re.fullmatch(r"[a-f0-9]{64}", recorded_hash):
            raise ValueError("Verified review requires its original drawing SHA-256; unverified examples cannot establish accuracy")
        if not isinstance(source, dict) or source.get("sha256") != recorded_hash:
            raise ValueError("Review refers to different source drawing bytes; export and review again")
        if example.get("decision") not in ("approved", "rejected"):
            raise ValueError("Only terminal reviewed examples belong in evaluation")
        shape_polygon(example["corrected"] if example["decision"] == "approved" else example["proposal"])
        current[floor["floorId"]].append(example)
    return floors, current, stale


def detector_sources() -> dict[str, str]:
    files = [*REPO.joinpath("src/server/rooms/hybrid").glob("*.ts"),
             REPO / "src/server/rooms/pdf-walls.ts", REPO / "src/server/rooms/hatch-filter.ts",
             REPO / "src/server/rooms/physical-labels.ts",
             REPO / "src/server/rooms/raster-rooms.ts", REPO / "src/lib/room-shape.ts",
             REPO / "src/server/rooms/detect-job.ts", REPO / "pnpm-lock.yaml",
             REPO / "scripts/rooms/bench/metrics.py", Path(__file__).resolve(),
             REPO / "scripts/rooms/complete/feedback-predict.ts"]
    return {str(p.relative_to(REPO)): file_hash(p) for p in sorted(set(files))}


def compare_reports(current: dict[str, Any], previous: dict[str, Any]) -> dict[str, Any]:
    for key in ("contract", "dataset_sha256", "split", "input_mode", "floor_ids", "metrics_runtime"):
        if current.get(key) != previous.get(key):
            raise ValueError(f"Comparison requires identical {key}")
    before, after = previous.get("all_space_summary"), current.get("all_space_summary")
    delta = ({k: after[k] - before[k] for k in ("recall50", "f1_50", "recall75", "f1_75", "fn50", "fp50", "failures", "mean_iou_all_gt")}
             if before is not None and after is not None else None)
    old = {r["floorId"]: r for r in previous["cases"]}
    regressions = []
    for row in current["cases"]:
        prior = old[row["floorId"]]
        reasons = []
        if row["status"] != "ok" and prior["status"] == "ok":
            reasons.append("new replay failure")
        if row.get("metrics") is not None and prior.get("metrics") is not None:
            if row["metrics"]["fn50"] > prior["metrics"]["fn50"]:
                reasons.append("more missed rooms")
            if row["metrics"]["f1_50"] < prior["metrics"]["f1_50"] - 1e-9:
                reasons.append("lower F1")
            if row["metrics"]["mean_iou_all_gt"] < prior["metrics"]["mean_iou_all_gt"] - 1e-9:
                reasons.append("lower boundary IoU including misses")
        if row["review_evidence"]["reviewed_rejected_proposals_reemitted65"] > prior["review_evidence"]["reviewed_rejected_proposals_reemitted65"]:
            reasons.append("more rejected proposals reemitted")
        if row["review_evidence"].get("missed_reviewed_positive50", 0) > prior["review_evidence"].get("missed_reviewed_positive50", 0):
            reasons.append("more missed reviewed positive examples")
        if row["review_evidence"].get("reviewed_positive_iou_sum", 0) < prior["review_evidence"].get("reviewed_positive_iou_sum", 0) - 1e-9:
            reasons.append("lower boundary IoU on reviewed positive examples")
        if reasons:
            regressions.append({"floorId": row["floorId"], "reasons": reasons})
    review_before, review_after = previous.get("review_evidence_summary"), current.get("review_evidence_summary")
    review_delta = ({key: review_after[key] - review_before[key] for key in review_after}
                    if review_before is not None and review_after is not None else None)
    return {"all_space_delta": delta, "review_evidence_delta": review_delta, "regressions": regressions,
            "previous_source_hashes": previous["source_hashes"]}


def run(args: argparse.Namespace) -> int:
    if args.split == "holdout" and not args.allow_holdout:
        raise ValueError("Holdout requires --allow-holdout; freeze the candidate before opening it")
    root = args.export.resolve()
    manifest = root / "feedback.json"
    export_hash = file_hash(manifest)
    payload = json.loads(manifest.read_text())
    floors, evidence, stale_count = validate_export(payload)
    selected = sorted((f for f in floors if f["split"] == args.split), key=lambda f: f["floorId"])
    if args.limit is not None:
        selected = selected[:args.limit]
    if not selected:
        raise ValueError("The selected split contains no floors; no accuracy can be reported")
    sources = detector_sources()
    assets: dict[str, tuple[Path, dict[str, Any]]] = {}
    fingerprints = []
    for floor in selected:
        image = floor.get("image")
        if not isinstance(image, dict) or not image.get("provenance"):
            raise ValueError("Every replay needs the hashed image and explicit input provenance")
        image_path = private_file(root, image)
        with Image.open(image_path) as rendered:
            if rendered.size != (image.get("width"), image.get("height")):
                raise ValueError("Snapshot dimensions do not match its image bytes")
        source = floor.get("sourceDrawing")
        if isinstance(source, dict) and source.get("path"):
            source_path = private_file(root, source)
        else:
            source_path = None
        if args.input == "production":
            if source_path is None or source.get("kind") != "pdf" or not isinstance(source.get("pageNumber"), int) or source["pageNumber"] < 1:
                raise ValueError("Production replay needs a copied, hashed PDF and its exact source page; use explicit --input preview for image-only analysis")
            if not source.get("provenance"):
                raise ValueError("Production source drawing must include its preparation provenance")
            assets[floor["floorId"]] = (source_path, source)
        else:
            assets[floor["floorId"]] = (image_path, image)
        fingerprints.append({"floor": floor, "examples": evidence[floor["floorId"]]})
    dataset_hash = canonical_hash(fingerprints)
    output = args.output.resolve()
    output.mkdir(mode=0o700)
    rows = []
    for floor in selected:
        if detector_sources() != sources or file_hash(manifest) != export_hash:
            raise ValueError("Detector source or export changed during replay; discard this run")
        asset_path, asset = assets[floor["floorId"]]
        private_file(root, asset)
        # Recheck both original drawing and preview snapshot even when only one enters detection.
        private_file(root, floor["image"])
        if isinstance(floor.get("sourceDrawing"), dict) and floor["sourceDrawing"].get("path"):
            private_file(root, floor["sourceDrawing"])
        token = hashlib.sha256(floor["floorId"].encode()).hexdigest()[:16]
        request_path, result_path = output / f"{token}.request.json", output / f"{token}.prediction.json"
        request = {"mode": args.input, "input": str(asset_path), "output": str(result_path),
                   "pageNumber": asset.get("pageNumber")}
        request_path.write_text(json.dumps(request))
        request_path.chmod(0o600)
        start = time.perf_counter()
        error, diagnostic, predictions = None, {}, []
        try:
            subprocess.run([args.node, "--max-old-space-size=768", "--import", "tsx",
                                      "scripts/rooms/complete/feedback-predict.ts", str(request_path)],
                                     cwd=REPO, capture_output=True, text=True, timeout=args.timeout, check=True)
            result = json.loads(result_path.read_text())
            diagnostic = result["diagnostic"]
            if diagnostic.get("mode") != args.input:
                raise ValueError("Replay adapter returned the wrong input pipeline")
            predictions = [shape_polygon(r["shape"]) for r in result["rooms"]]
        except Exception as failure:
            # Do not echo child environment, file contents, or raw subprocess output into reports.
            error = {"type": type(failure).__name__, "detail": "Replay failed or returned invalid geometry"}
        events = evidence[floor["floorId"]]
        positives = [shape_polygon(e["corrected"]) for e in events if e["decision"] == "approved"]
        rejects = [shape_polygon(e["proposal"]) for e in events if e["decision"] == "rejected"]
        reviewed = partial_evidence(positives, rejects, predictions)
        metrics = full_metrics([shape_polygon(r["shape"]) for r in floor["approvedRooms"]], predictions) if complete_floor(floor) else None
        row = {"floorId": floor["floorId"], "group": floor["jobId"], "status": "ok" if error is None else "error",
               "error": error, "metrics": metrics, "review_evidence": reviewed, "diagnostic": diagnostic,
               "timing": {"wall_ms": (time.perf_counter() - start) * 1000},
               "input_sha256": asset["sha256"], "complete_ground_truth": complete_floor(floor),
               "input_provenance": floor["image"]["provenance"],
               "source_drawing_provenance": (floor.get("sourceDrawing") or {}).get("provenance"),
               "review_completeness_provenance": floor.get("reviewCompletenessProvenance"),
               "completeness_reviewed_at": floor.get("completenessReviewedAt")}
        rows.append(row)
        print(f"Replayed {len(rows)}/{len(selected)} floors; complete ground truth: {sum(r['complete_ground_truth'] for r in rows)}", flush=True)
    if detector_sources() != sources or file_hash(manifest) != export_hash:
        raise ValueError("Detector source or export changed; this run is not rankable")
    for floor in selected:
        private_file(root, floor["image"])
        if isinstance(floor.get("sourceDrawing"), dict) and floor["sourceDrawing"].get("path"):
            private_file(root, floor["sourceDrawing"])
    complete = [row for row in rows if row["metrics"] is not None]
    report: dict[str, Any] = {"version": 1, "contract": CONTRACT, "input_mode": args.input, "split": args.split,
        "metrics_runtime": {"python": sys.version.split()[0], "numpy": np.__version__,
                            "shapely": version("shapely"), "pillow": version("pillow")},
        "dataset_sha256": dataset_hash, "export_sha256": export_hash, "source_hashes": sources,
        "floor_ids": [f["floorId"] for f in selected], "job_groups": sorted({f["jobId"] for f in selected}),
        "ignored_stale_examples": stale_count, "ignored_unverified_examples": len(payload.get("unverifiedExamples", [])), "cases": rows,
        "all_space_summary": aggregate(complete) if complete else None,
        "complete_floor_ranking": [{"floorId": r["floorId"], "missed50": r["metrics"]["fn50"],
                                    "extra50": r["metrics"]["fp50"], "f1_50": r["metrics"]["f1_50"],
                                    "mean_iou_all_gt": r["metrics"]["mean_iou_all_gt"]}
                                   for r in sorted(complete, key=lambda r: (-r["metrics"]["fn50"], r["metrics"]["f1_50"]))],
        "review_evidence_summary": {key: sum(r["review_evidence"][key] for r in rows) for key in rows[0]["review_evidence"]},
        "limitations": ["Complete ground truth requires explicit user completeness attestation, including manually added missed rooms.",
                         "Partially reviewed drawings cannot establish all-space recall, F1, or unknown-region false positives.",
                         "Rejected proposals measure proposal quality; they are never background segmentation masks.",
                         "Production mode replays the PDF preparation and candidate geometry, without organization review-memory filtering or DB reconciliation.",
                         "Preview mode is image-only geometry analysis, not production PDF/OCR accuracy."]}
    if args.compare:
        report["comparison"] = compare_reports(report, json.loads(args.compare.read_text()))
    report_path = output / "report.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False))
    report_path.chmod(0o600)
    print(f"Report: {report_path}")
    if report["all_space_summary"] is None:
        print("No fully reviewed complete floors: all-space accuracy remains unknown.")
    else:
        print(json.dumps(report["all_space_summary"], sort_keys=True))
    if args.fail_on_regression and report.get("comparison", {}).get("regressions"):
        return 2
    return 1 if any(r["status"] != "ok" for r in rows) else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", type=Path, required=True, help="Private version-2 export directory")
    parser.add_argument("--output", type=Path, required=True, help="A new private report directory")
    parser.add_argument("--split", choices=("development", "holdout"), default="development")
    parser.add_argument("--allow-holdout", action="store_true")
    parser.add_argument("--input", choices=("production", "preview"), default="production")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--node", default="node")
    parser.add_argument("--compare", type=Path)
    parser.add_argument("--fail-on-regression", action="store_true")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1 or args.timeout < 1:
        parser.error("Limit and timeout must be positive")
    try:
        return run(args)
    except (ValueError, OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        parser.exit(1, f"Evaluation refused: {error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
