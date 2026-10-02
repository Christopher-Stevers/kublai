"""Wrap one existing physical-eval trial into the saved-prediction contract. No inference."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from score import (POLICIES, canonical_hash, file_hash, identity, local_asset, read_json,
                   require_hash, source_hashes, verify_pins)
from evaluate_feedback import job_split


def wrap(trial, feedback_path, floor_id, mode, policy, destination):
    if policy not in POLICIES or mode not in ("physical", "tagged"):
        raise ValueError("An explicit target policy and trial mode are required")
    if policy != {"physical": "physical-spaces", "tagged": "units-and-common"}[mode]:
        raise ValueError("Known physical-eval mode semantics cannot be relabeled by a CLI target flag")
    sources = {**source_hashes(), str(Path(__file__).resolve()): file_hash(Path(__file__).resolve())}
    pins = {}
    feedback = read_json(feedback_path, pins)
    if feedback.get("version") != 2:
        raise ValueError("Use a source-bound version-2 private export")
    floors = feedback.get("floors", [])
    chosen = [f for f in floors if f.get("floorId") == floor_id]
    if len(chosen) != 1:
        raise ValueError("Choose one exact exported floor")
    floor = chosen[0]
    source = floor.get("sourceDrawing", {})
    pdf_hash = require_hash(source.get("sha256"))
    if type(source.get("pageNumber")) is not int or source["pageNumber"] < 1:
        raise ValueError("Export must identify an original PDF page")
    for row in floors:
        if row.get("sourceDrawing", {}).get("sha256") == pdf_hash:
            job = row.get("jobId")
            if not isinstance(job, str) or row.get("split") != "development" or job_split(job) != "development":
                raise ValueError("A whole PDF alias is held out; wrapping is development-only")
    plan = read_json(trial / "plan.json", pins)
    completed = read_json(trial / "completed.json", pins)
    if (plan.get("version") != "physical-eval-v1" or
            completed.get("planSha256") != pins[str((trial / "plan.json").resolve())] or
            completed.get("sourceChangedDuringRun") is not False or
            completed.get("finalSourceManifestSha256") != plan.get("sourceState", {}).get("sourceManifestSha256")):
        raise ValueError("Trial lacks unchanged, source-bound completion evidence")
    if (plan.get("sourcePdfSha256") != pdf_hash or plan.get("pdfPageNumber") != source.get("pageNumber") or
            plan.get("pdfPageIndex") != source.get("pageNumber") - 1):
        raise ValueError("Trial is from another PDF or original page")
    exact_source = trial / "source.pdf"
    if file_hash(exact_source) != pdf_hash:
        raise ValueError("Archived original trial PDF changed")
    pins[str(exact_source.resolve())] = pdf_hash
    archive = plan["sourceState"].get("manifest")
    if not isinstance(archive, list) or not archive:
        raise ValueError("Trial needs its detector source archive")
    # physical-eval hashes JSON.stringify(manifest, null, 2) plus a newline.
    encoded = (json.dumps(archive, indent=2, ensure_ascii=False) + "\n").encode()
    import hashlib
    if hashlib.sha256(encoded).hexdigest() != plan["sourceState"]["sourceManifestSha256"]:
        raise ValueError("Detector source inventory identity differs")
    for asset in archive:
        path = local_asset(trial / "sources", asset)
        digest = require_hash(asset.get("sha256"))
        if file_hash(path) != digest:
            raise ValueError("Archived detector source bytes changed")
        pins[str(path)] = digest
    outputs = completed.get("outputs")
    if not isinstance(outputs, list):
        raise ValueError("Trial requires emitted output byte pins")
    seen = set()
    for asset in outputs:
        path = local_asset(trial, asset)
        if str(path) in seen:
            raise ValueError("Duplicate emitted trial asset")
        seen.add(str(path))
        digest = require_hash(asset.get("sha256"))
        if file_hash(path) != digest:
            raise ValueError("Emitted trial bytes changed")
        pins[str(path)] = digest
    runs = [r for r in completed.get("results", []) if r.get("mode") == mode]
    if len(runs) != 1 or runs[0].get("status") not in ("completed", "failed", "timeout", "rss-limit"):
        raise ValueError("Selected mode has no terminal execution result")
    run = runs[0]
    rooms, stats = [], {}
    if run["status"] == "completed":
        result_path = (trial / mode / "result.json").resolve(strict=True)
        if str(result_path) not in seen:
            raise ValueError("Candidate result was not bound at trial completion")
        result = read_json(result_path, pins)
        if not isinstance(result.get("rooms"), list) or not isinstance(result.get("stats"), dict):
            raise ValueError("Selected mode lacks a complete candidate result")
        stats = result["stats"]
        rooms = [{"id": f"{mode}-{i:04d}", "name": row.get("name", ""), "shape": row["shape"]}
                 for i, row in enumerate(result["rooms"])]
    prediction = {"version": 1, "sheetId": floor_id, "targetPolicy": policy,
        "source": {"pdfSha256": pdf_hash, "originalPageOneBased": source["pageNumber"]},
        "coordinateFrame": {"coordinates": "normalized-original-page", "width": floor["image"]["width"],
                            "height": floor["image"]["height"]},
        "producer": {"name": f"physical-eval-v1/{mode}", "sourceSha256": plan["sourceState"]["sourceManifestSha256"],
                     "configSha256": canonical_hash({"mode": mode, "planConfig": plan.get("config"), "resultConfig": stats.get("config")}),
                     "targetPolicyProvenance": "Operator explicitly selected the meaning of these saved proposals.",
                     "trialCompletionStatus": completed.get("status"), "trialInputHashes": pins.copy(),
                     "wrapperSourceHashes": sources},
        "status": "completed" if run["status"] == "completed" else "failed", "rooms": rooms,
        "execution": {"elapsedMs": run.get("elapsedMs"),
                      "peakRssBytes": max(run.get("sampledPeakRssBytes") or 0, run.get("childPeakRssBytes") or 0)}}
    identity(prediction)
    if prediction["status"] == "failed":
        prediction["error"] = run.get("error") or f"Trial mode ended as {run['status']}"
    verify_pins({**pins, **sources})
    with destination.open("x", encoding="utf-8") as handle:
        json.dump(prediction, handle, indent=2, allow_nan=False)
        handle.write("\n")
    destination.chmod(0o600)
    emitted = file_hash(destination)
    verify_pins({**pins, **sources, str(destination.resolve()): emitted})
    return prediction


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trial", required=True, type=Path)
    parser.add_argument("--feedback", required=True, type=Path)
    parser.add_argument("--floor-id", required=True)
    parser.add_argument("--mode", required=True, choices=["physical", "tagged"])
    parser.add_argument("--target-policy", required=True, choices=sorted(POLICIES))
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    wrap(args.trial, args.feedback, args.floor_id, args.mode, args.target_policy, args.out)
    print(f"Wrapped existing saved trial: {args.out}")


if __name__ == "__main__":
    main()
