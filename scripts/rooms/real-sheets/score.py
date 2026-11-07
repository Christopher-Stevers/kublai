"""Offline real-sheet polygon scoring. Saved proposals only; no detector, DB or GPU."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import html
from importlib.metadata import version
import json
import math
from pathlib import Path
import re
import sys
import unicodedata

import numpy as np
from shapely.affinity import scale
from shapely.ops import unary_union

ROOMS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOMS / "complete"))
from evaluate_feedback import shape_polygon, overlap_matrix, canonical_hash, file_hash  # noqa: E402
from metrics import match_at  # noqa: E402

CONTRACT = "real-sheet-polygon-review-v1"
POLICIES = {"physical-spaces": {"room", "common"}, "units-and-common": {"unit", "common"}}
MAX_JSON_BYTES = 32 * 1024 * 1024


def require_hash(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
        raise ValueError("Expected a lowercase SHA-256")
    return value


def identity(value):
    source = value.get("source", {})
    digest = require_hash(source.get("pdfSha256"))
    page = source.get("originalPageOneBased")
    if type(page) is not int or page < 1:
        raise ValueError("originalPageOneBased must be explicit; app import slots are not PDF pages")
    if "originalPageIndex" in source and source["originalPageIndex"] != page - 1:
        raise ValueError("Original PDF page index disagrees with its one-based page")
    return {"pdfSha256": digest, "originalPageOneBased": page}


def frame(value):
    result = value.get("coordinateFrame")
    if not isinstance(result, dict) or result.get("coordinates") != "normalized-original-page":
        raise ValueError("Geometry must use the uncropped original page coordinate frame")
    if any(type(result.get(k)) is not int or not 1 <= result[k] <= 100000 for k in ("width", "height")):
        raise ValueError("Page frame requires bounded positive width and height")
    return result


def snapshot_hash(reference):
    """The human assertion binds exact geometry, exclusions, policy and original page."""
    return canonical_hash({k: reference.get(k) for k in
                           ("sheetId", "source", "coordinateFrame", "targetPolicy", "rooms", "exclusions", "rejected")})


def review_scope(reference):
    review = reference.get("review", {})
    scope = review.get("scope")
    if scope not in ("complete-sheet", "reviewed-subset"):
        raise ValueError("Review scope must distinguish complete-sheet from reviewed-subset")
    for field in ("reviewer", "provenance"):
        if not isinstance(review.get(field), str) or not review[field].strip():
            raise ValueError("Review needs an attributed human provenance assertion")
    try:
        stamp = datetime.fromisoformat(review["reviewedAt"].replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            raise ValueError()
    except (KeyError, TypeError, ValueError, AttributeError):
        raise ValueError("Review requires a timezone-aware review timestamp") from None
    if identity({"source": review}) != identity(reference) or review.get("targetPolicy") != reference.get("targetPolicy"):
        raise ValueError("Review attestation does not bind this original page and target policy")
    if require_hash(review.get("reviewedSnapshotSha256")) != snapshot_hash(reference):
        raise ValueError("Reviewed geometry or exclusions changed after attestation")
    return scope


def room_polygons(rows, kinds=None):
    if not isinstance(rows, list) or len(rows) > 2000:
        raise ValueError("Expected at most 2000 explicitly identified instances")
    identifiers = set()
    result = []
    for row in rows:
        ident = row.get("id")
        if not isinstance(ident, str) or not ident or ident in identifiers:
            raise ValueError("Room identifiers must be nonempty and unique")
        identifiers.add(ident)
        if kinds is not None and row.get("kind") not in kinds:
            raise ValueError("Reference kind conflicts with target policy")
        if "name" in row and not isinstance(row["name"], str):
            raise ValueError("Room names must be strings")
        if "nameAliases" in row and (not isinstance(row["nameAliases"], list) or
                                      any(not isinstance(x, str) or not x.strip() for x in row["nameAliases"])):
            raise ValueError("Name aliases must be explicit nonempty strings")
        result.append((row, shape_polygon(row["shape"])))
    return result


def normalized_name(value):
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def score_case(reference, prediction, *, boundaries=False):
    if reference.get("version") != 1 or prediction.get("version") != 1:
        raise ValueError("Use explicit version-1 real-sheet reference and prediction manifests")
    policy = reference.get("targetPolicy")
    if policy not in POLICIES or prediction.get("targetPolicy") != policy:
        raise ValueError("Explicit target policy must agree; suites and physical rooms cannot be compared")
    if not isinstance(reference.get("sheetId"), str) or not reference["sheetId"] or prediction.get("sheetId") != reference["sheetId"]:
        raise ValueError("Sheet identities differ")
    source = identity(reference)
    if identity(prediction) != source or frame(reference) != frame(prediction):
        raise ValueError("Prediction is from different source bytes, original page or coordinate frame")
    scope = review_scope(reference)
    producer = prediction.get("producer", {})
    if not isinstance(producer.get("name"), str) or not producer["name"]:
        raise ValueError("Prediction requires an identified producer")
    for key in ("sourceSha256", "configSha256"):
        require_hash(producer.get(key))
    status = prediction.get("status")
    if status not in ("completed", "failed"):
        raise ValueError("Prediction status must explicitly retain detector failures")
    proposed = room_polygons(prediction.get("rooms"))
    if status == "failed" and (proposed or not isinstance(prediction.get("error"), str) or not prediction["error"]):
        raise ValueError("Failed detector must have an error and no credited proposals")
    timing = prediction.get("execution", {})
    for key in ("elapsedMs", "peakRssBytes"):
        value = timing.get(key)
        if value is not None and (type(value) not in (int, float) or not math.isfinite(value) or value < 0):
            raise ValueError("Execution measurements must be finite and nonnegative")
    expected = room_polygons(reference.get("rooms"), POLICIES[policy])
    rejected = room_polygons(reference.get("rejected", []))
    masks = room_polygons(reference.get("exclusions", []))
    mask = unary_union([p for _, p in masks])

    def masked(rows):
        kept, excluded = [], []
        for row, polygon in rows:
            geometry = polygon.difference(mask)
            if geometry.is_empty or geometry.area <= 1e-12:
                excluded.append(row["id"])
            else:
                kept.append((row, geometry))
        return kept, excluded

    truth, excluded_truth = masked(expected)
    candidates, excluded_candidates = masked(proposed)
    negatives, excluded_rejections = masked(rejected)
    for i, (_, a) in enumerate(truth):
        for _, b in truth[i + 1:]:
            if a.intersection(b).area > 1e-10:
                raise ValueError("Reference instances overlap; resolve duplicate/nested target annotations")
    ious, coverage = overlap_matrix([p for _, p in truth], [p for _, p in candidates])
    n, m = len(truth), len(candidates)
    result = {"sheetId": reference["sheetId"], "source": source, "targetPolicy": policy,
              "reviewScope": scope, "detectorStatus": status, "execution": timing,
              "expected": n, "predicted": m,
              "excludedReferenceIds": excluded_truth, "excludedPredictionIds": excluded_candidates,
              "excludedRejectionIds": excluded_rejections,
              "wholeSheetMetrics": None, "reviewedEvidence": {}, "matches": {},
              "referenceStatus": "nonempty-reviewed-reference" if n else "insufficient-positive-reference"}
    result["exclusionMasking"] = {label: [{"id": row["id"],
        "fractionRemoved": float(p.intersection(mask).area / p.area)} for row, p in items]
        for label, items in (("reference", expected), ("prediction", proposed), ("rejection", rejected))}
    matches50 = {}
    for threshold, suffix in ((0.5, "50"), (0.75, "75")):
        matches = match_at(ious, threshold)
        if suffix == "50":
            matches50 = matches
        result["matches"][suffix] = [{"referenceId": truth[i][0]["id"], "predictionId": candidates[j][0]["id"],
                                       "iou": float(ious[i, j])} for j, i in sorted(matches.items())]
        result["reviewedEvidence"].update({f"recovered{suffix}": len(matches), f"missed{suffix}": n - len(matches)})
    negative_ious, _ = overlap_matrix([p for _, p in negatives], [p for _, p in candidates])
    thresholds = np.asarray([.65 if row.get("reviewReason") == "not-space" else .98 for row, _ in negatives])[:, None]
    reemitted = negative_ious >= thresholds
    result["reviewedEvidence"].update({"positiveCount": n, "rejectionCount": len(negatives),
        "reemittedRejectedProposals": int(np.sum(reemitted.any(axis=1))),
        "candidatesMatchingRejectedProposals": int(np.sum(reemitted.any(axis=0))),
        "rejections": [{"id": row["id"], "reviewReason": row.get("reviewReason"),
                         "iouThreshold": float(thresholds[i, 0]), "reemitted": bool(reemitted[i].any()),
                         "matchingPredictionIds": [candidates[j][0]["id"] for j in np.flatnonzero(reemitted[i])]}
                        for i, (row, _) in enumerate(negatives)]})
    if scope == "complete-sheet" and n:
        metrics = {}
        for suffix in ("50", "75"):
            tp = len(result["matches"][suffix])
            metrics.update({f"tp{suffix}": tp, f"misses{suffix}": n - tp, f"extras{suffix}": m - tp,
                            f"recall{suffix}": tp / n, f"precision{suffix}": tp / m if m else 0.0,
                            f"f1_{suffix}": 2 * tp / (n + m)})
        metrics.update(bleedCandidates=int(np.sum(np.sum(coverage >= .5, axis=0) >= 2)),
                       splitCandidates=int(np.sum((np.sum(coverage >= .15, axis=1) >= 2) & (coverage.sum(axis=1) >= .5))),
                       zeroMisses50=metrics["misses50"] == 0,
                       noMissesOrExtras50=metrics["misses50"] == 0 and metrics["extras50"] == 0)
        result["wholeSheetMetrics"] = metrics
        result["bleedPredictionIds"] = [candidates[j][0]["id"] for j in np.flatnonzero(np.sum(coverage >= .5, axis=0) >= 2)]
        result["splitReferenceIds"] = [truth[i][0]["id"] for i in np.flatnonzero((np.sum(coverage >= .15, axis=1) >= 2) & (coverage.sum(axis=1) >= .5))]
    named, correct = 0, 0
    distances = []
    width, height = frame(reference)["width"], frame(reference)["height"]
    diagonal = math.hypot(width, height)
    for j, i in matches50.items():
        target, candidate = truth[i][0], candidates[j][0]
        aliases = [target.get("name", ""), *target.get("nameAliases", [])]
        aliases = {normalized_name(x) for x in aliases if x.strip()}
        if aliases:
            named += 1
            correct += normalized_name(candidate.get("name", "")) in aliases
        if boundaries:
            a = scale(truth[i][1], xfact=width / diagonal, yfact=height / diagonal, origin=(0, 0))
            b = scale(candidates[j][1], xfact=width / diagonal, yfact=height / diagonal, origin=(0, 0))
            distances.append(float(a.boundary.hausdorff_distance(b.boundary)))
    result["naming"] = {"matchedWithReferenceName": named, "correct": correct,
                         "accuracy": correct / named if named else None,
                         "comparison": "NFKC, casefold and whitespace; explicit aliases only"}
    result["boundary"] = {"metric": "matched50 symmetric boundary Hausdorff / original-page diagonal",
                           "count": len(distances), "mean": float(np.mean(distances)) if distances else None,
                           "maximum": max(distances) if distances else None} if boundaries else None
    result["unmatchedReferenceIds"] = [row["id"] for i, (row, _) in enumerate(truth) if i not in matches50.values()]
    result["unmatchedPredictionIds"] = [row["id"] for j, (row, _) in enumerate(candidates) if j not in matches50]
    return result


def overlay(reference, prediction, result):
    """Transparent SVG in the original page frame; no source pixels or text are loaded."""
    width, height = frame(reference)["width"], frame(reference)["height"]
    matched = {row["predictionId"] for row in result["matches"]["50"]}
    bleeds = set(result.get("bleedPredictionIds", []))
    pieces = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}">',
              f'<title>{html.escape(reference["sheetId"])}: reviewed geometry comparison</title>']
    for rows, category in ((reference.get("exclusions", []), "exclude"), (reference["rooms"], "reference"),
                           (prediction["rooms"], "prediction")):
        for row in rows:
            p = shape_polygon(row["shape"])
            rings = [p.exterior, *p.interiors]
            path = " ".join("M " + " L ".join(f"{x*width:.6f},{y*height:.6f}" for x, y in ring.coords) + " Z" for ring in rings)
            if category in ("exclude", "reference") or row["id"] in result["excludedPredictionIds"]:
                color = "#64748b"
            elif row["id"] in bleeds:
                color = "#dc2626"
            elif row["id"] in matched:
                color = "#16a34a"
            else:
                color = "#dc2626" if result["wholeSheetMetrics"] is not None else "#2563eb"
            pieces.append(f'<path d="{path}" fill="{color}" fill-opacity="{0.08 if category != "reference" else 0}" fill-rule="evenodd" stroke="{color}" stroke-width="{max(width,height)/1000}"{chr(32)+"stroke-dasharray=\"8 5\"" if category == "reference" else ""}><title>{html.escape(category+": "+row["id"])}</title></path>')
    return "\n".join([*pieces, "</svg>"])


def runtime():
    return {"python": sys.version, **{name: version(name) for name in ("numpy", "shapely", "Pillow")}}


def source_hashes():
    paths = [Path(__file__).resolve(), ROOMS / "complete/evaluate_feedback.py", ROOMS / "bench/metrics.py"]
    return {str(p): file_hash(p) for p in paths}


def read_json(path, pins, expected=None):
    path = path.resolve(strict=True)
    if path.stat().st_size > MAX_JSON_BYTES:
        raise ValueError("JSON exceeds bounded evaluation input budget")
    digest = file_hash(path)
    if expected is not None and require_hash(expected) != digest:
        raise ValueError("Input bytes differ from their frozen manifest hash")
    pins[str(path)] = digest
    def bad_constant(value):
        raise ValueError(f"Nonfinite JSON constant: {value}")
    payload = json.loads(path.read_bytes(), parse_constant=bad_constant)
    if file_hash(path) != digest:
        raise ValueError("Input changed during JSON decoding")
    return payload


def local_asset(root, value):
    name = value.get("path")
    if not isinstance(name, str) or Path(name).is_absolute():
        raise ValueError("Manifest paths must be relative private assets")
    path = (root / name).resolve(strict=True)
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError("Input escapes the private manifest directory")
    return path


def verify_pins(pins):
    if any(file_hash(Path(path)) != digest for path, digest in pins.items()):
        raise ValueError("Frozen input/source/output bytes changed during evaluation")


def evaluate(manifest_path, output, *, boundaries=False):
    pins, sources, initial_runtime = {}, source_hashes(), runtime()
    manifest = read_json(manifest_path, pins)
    if manifest.get("version") != 1 or manifest.get("split") != "development":
        raise ValueError("This repeatable scorer supports development only; protected/holdout evaluation needs its own once-only protocol")
    if manifest.get("targetPolicy") not in POLICIES:
        raise ValueError("One explicit target policy is required for the whole comparison set")
    cases = manifest.get("cases")
    if not isinstance(cases, list) or not 1 <= len(cases) <= 100:
        raise ValueError("Manifest must bind 1..100 development cases")
    seen, pdf_sites = set(), {}
    # Scope/whole-PDF grouping is checked before reading any reference geometry.
    for case in cases:
        ident = identity(case)
        key = (ident["pdfSha256"], ident["originalPageOneBased"])
        site = case.get("siteId")
        if not isinstance(site, str) or not site or case.get("split") != "development" or key in seen:
            raise ValueError("Duplicate original page or nondevelopment case")
        if pdf_sites.setdefault(ident["pdfSha256"], site) != site:
            raise ValueError("Whole PDF aliases must retain the same site identity")
        seen.add(key)
    rows, prepared, references = [], [], []
    root = manifest_path.resolve().parent
    for case in cases:
        reference_path = local_asset(root, case["reference"])
        prediction_path = local_asset(root, case["prediction"])
        reference = read_json(reference_path, pins, case["reference"]["sha256"])
        prediction = read_json(prediction_path, pins, case["prediction"]["sha256"])
        if reference.get("targetPolicy") != manifest["targetPolicy"]:
            raise ValueError("Cannot aggregate different target policies")
        if identity(reference) != identity(case) or reference.get("siteId") != case["siteId"]:
            raise ValueError("Reference does not match predeclared original page/site")
        pdf_asset = reference.get("source", {}).get("pdf", {})
        pdf_path = local_asset(reference_path.parent, pdf_asset)
        pdf_hash = require_hash(pdf_asset.get("sha256"))
        if pdf_hash != identity(reference)["pdfSha256"] or file_hash(pdf_path) != pdf_hash:
            raise ValueError("Exact original PDF bytes are required, without rendering them")
        pins[str(pdf_path)] = pdf_hash
        row = score_case(reference, prediction, boundaries=boundaries)
        rows.append(row)
        prepared.append((reference, prediction, row))
        references.append({"source": identity(reference), "siteId": case["siteId"], "referenceSha256": case["reference"]["sha256"]})
    report = {"contract": CONTRACT, "evaluatedAt": datetime.now(timezone.utc).isoformat(),
              "split": "development", "referenceSetSha256": canonical_hash(references),
              "targetPolicy": manifest["targetPolicy"],
              "manifestSha256": pins[str(manifest_path.resolve())], "inputHashes": pins.copy(),
              "sourceHashes": sources, "runtime": initial_runtime, "boundariesEnabled": boundaries,
              "cases": rows, "summary": summarize(rows),
              "limitations": ["Human attestations are attributed assertions, not independent certification.",
                               "Partial reviews cannot establish all-space recall, precision, junk or floor completeness.",
                               "Zero positive reference never establishes perfect accuracy, including an empty sheet.",
                               "Exclusions are subtracted from both sides; ignored candidates are reported separately.",
                               "No deployment gate, actual detector run, holdout score or model training is performed."]}
    verify_pins({**pins, **sources})
    if runtime() != initial_runtime:
        raise ValueError("Scoring runtime changed")
    output.mkdir(mode=0o700)
    outputs = {}
    for index, (reference, prediction, row) in enumerate(prepared):
        path = output / f"sheet-{index:03d}.svg"
        with path.open("x", encoding="utf-8") as handle:
            handle.write(overlay(reference, prediction, row))
        path.chmod(0o600)
        outputs[str(path.resolve())] = file_hash(path)
    report["overlayHashes"] = outputs.copy()
    path = output / "report.json"
    with path.open("x", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, allow_nan=False)
        handle.write("\n")
    path.chmod(0o600)
    outputs[str(path.resolve())] = file_hash(path)
    verify_pins({**pins, **sources, **outputs})
    if runtime() != initial_runtime:
        raise ValueError("Scoring runtime changed before completion")
    completed = {"contract": CONTRACT, "outputDirectory": str(output.resolve()),
                 "manifestSha256": report["manifestSha256"], "outputs": outputs}
    with (output / "COMPLETED.json").open("x", encoding="utf-8") as handle:
        json.dump(completed, handle, indent=2, allow_nan=False)
        handle.write("\n")
    (output / "COMPLETED.json").chmod(0o600)
    verify_pins({**pins, **sources, **outputs})
    return report


def read_completed(directory):
    """Existence alone is not completion: copied folders and changed bytes fail."""
    directory = directory.resolve(strict=True)
    pins = {}
    receipt = read_json(directory / "COMPLETED.json", pins)
    if receipt.get("contract") != CONTRACT or receipt.get("outputDirectory") != str(directory):
        raise ValueError("Completion belongs to a different original output directory")
    outputs = receipt.get("outputs")
    if not isinstance(outputs, dict) or str(directory / "report.json") not in outputs:
        raise ValueError("Completion does not bind its report")
    if any(Path(name).parent != directory for name in outputs):
        raise ValueError("Completion output escapes its original directory")
    report = read_json(directory / "report.json", pins, outputs[str(directory / "report.json")])
    if (report.get("contract") != CONTRACT or report.get("split") != "development" or
            report.get("manifestSha256") != receipt.get("manifestSha256") or
            report.get("runtime") != runtime() or report.get("sourceHashes") != source_hashes()):
        raise ValueError("Report contract, source, manifest or runtime differs from completion")
    overlays = report.get("overlayHashes")
    if not isinstance(overlays, dict) or outputs != {**overlays, str(directory / "report.json"): pins[str(directory / "report.json")]}:
        raise ValueError("Completed output inventory differs from the emitted report")
    if set(overlays) != {str(directory / f"sheet-{i:03d}.svg") for i in range(len(report.get("cases", [])))}:
        raise ValueError("Not every declared case has a bound overlay")
    verify_pins({**report["inputHashes"], **report["sourceHashes"], **outputs, **pins})
    return report


def compare_reports(before, after):
    for key in ("contract", "split", "targetPolicy", "referenceSetSha256", "runtime", "boundariesEnabled", "sourceHashes"):
        if before.get(key) != after.get(key):
            raise ValueError(f"Comparison requires identical {key}; re-score both with one contract")
    old = {(r["source"]["pdfSha256"], r["source"]["originalPageOneBased"]): r for r in before["cases"]}
    current = {(r["source"]["pdfSha256"], r["source"]["originalPageOneBased"]): r for r in after["cases"]}
    if old.keys() != current.keys() or len(old) != len(before["cases"]) or len(current) != len(after["cases"]):
        raise ValueError("Comparison requires the exact same unique original pages")
    rows = []
    for key, row in current.items():
        prior = old[key]
        a, b = prior["wholeSheetMetrics"], row["wholeSheetMetrics"]
        delta = ({k: b[k] - a[k] for k in ("misses50", "extras50", "recall50", "bleedCandidates", "splitCandidates")}
                 if a is not None and b is not None else None)
        rows.append({"sheetId": row["sheetId"], "wholeSheetDelta": delta,
                     "reviewedRecovered50Delta": row["reviewedEvidence"]["recovered50"] - prior["reviewedEvidence"]["recovered50"],
                     "reviewedRejectedProposalReemissionsDelta": row["reviewedEvidence"]["reemittedRejectedProposals"] - prior["reviewedEvidence"]["reemittedRejectedProposals"],
                     "newDetectorFailure": row["detectorStatus"] == "failed" and prior["detectorStatus"] != "failed"})
    return {"contract": CONTRACT, "referenceSetSha256": after["referenceSetSha256"], "cases": rows,
            "shipDecision": None, "limitation": "Policy and ship thresholds remain a product decision; partial evidence cannot establish ship accuracy."}


def summarize(rows):
    usable = [r for r in rows if r["wholeSheetMetrics"] is not None]
    result = {"cases": len(rows), "completeNonemptyCases": len(usable),
              "partialCases": sum(r["reviewScope"] == "reviewed-subset" for r in rows),
              "zeroPositiveReferenceCases": sum(r["expected"] == 0 for r in rows),
              "detectorFailures": sum(r["detectorStatus"] == "failed" for r in rows),
              "wholeSheetMetrics": None}
    if usable:
        metrics = {key: sum(r["wholeSheetMetrics"][key] for r in usable)
                   for key in ("tp50", "misses50", "extras50", "tp75", "misses75", "extras75", "bleedCandidates", "splitCandidates")}
        n, m = sum(r["expected"] for r in usable), sum(r["predicted"] for r in usable)
        for suffix in ("50", "75"):
            tp = metrics[f"tp{suffix}"]
            metrics.update({f"recall{suffix}": tp / n, f"precision{suffix}": tp / m if m else 0.0,
                            f"f1_{suffix}": 2 * tp / (n + m)})
        metrics.update(expected=n, predicted=m,
                       zeroMissesFloors50=sum(r["wholeSheetMetrics"]["zeroMisses50"] for r in usable),
                       noMissesOrExtrasFloors50=sum(r["wholeSheetMetrics"]["noMissesOrExtras50"] for r in usable))
        result["wholeSheetMetrics"] = metrics
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--boundaries", action="store_true")
    parser.add_argument("--compare", type=Path, help="Previously completed output directory with the identical reference set/contract")
    args = parser.parse_args()
    report = evaluate(args.manifest, args.out, boundaries=args.boundaries)
    if args.compare:
        print(json.dumps(compare_reports(read_completed(args.compare), read_completed(args.out)), indent=2))
    print("Sheet | Review | Misses50 | Extras50 | Bleeds | Splits | Recall50 | Detector")
    for row in report["cases"]:
        m = row["wholeSheetMetrics"] or {}
        values = [row["sheetId"], row["reviewScope"], *[str(m.get(k, "unknown")) for k in
                  ("misses50", "extras50", "bleedCandidates", "splitCandidates", "recall50")], row["detectorStatus"]]
        print(" | ".join(values))
    print(f"Report: {args.out / 'report.json'}")


if __name__ == "__main__":
    main()
