"""Convert private source-verified review exports and saved predictions, without DB access."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re

from score import (ROOMS, canonical_hash, file_hash, read_json, review_scope, score_case,
                   snapshot_hash, source_hashes, verify_pins)
from evaluate_feedback import complete_floor, private_file, validate_export, job_split


def reference_from_floor(floor, examples, *, confirmed_target):
    # The old export's target field is hardcoded. A user/operator must verify
    # what was actually reviewed; a suite cannot become a physical room by rename.
    if confirmed_target != "physical-spaces":
        raise ValueError("Existing exports support physical-spaces only; never silently relabel suites")
    source = floor.get("sourceDrawing", {})
    page = source.get("pageNumber")
    if type(page) is not int or page < 1:
        raise ValueError("Export must contain an explicit original source PDF page")
    for example in examples:
        recorded = example.get("sourcePageNumber")
        metadata = example.get("detection") or {}
        if ((recorded is not None and recorded != page) or
                (isinstance(metadata, dict) and metadata.get("pdfPageNumber") is not None and metadata["pdfPageNumber"] != page)):
            raise ValueError("Reviewed event refers to a different original PDF page")
    approved = floor.get("approvedRooms", [])
    if not complete_floor(floor):
        active = {r["id"]: r for r in approved}
        approved = []
        for example in examples:
            current = active.get(example["id"])
            if (example["decision"] == "approved" and current is not None and
                    example.get("sourceReviewHash") == source["sha256"] and
                    example.get("corrected") == current["shape"]):
                approved.append({"id": current["id"], "shape": example["corrected"]})
    rejections = [{"id": e["id"], "shape": e["proposal"], "reviewReason": e.get("reviewReason")}
                  for e in examples if e["decision"] == "rejected"]
    if not approved and not rejections:
        raise ValueError("No current immutable source-verified reviews for this floor")
    stamp = (floor["completenessReviewedAt"] if complete_floor(floor) else
             max(e["reviewedAt"] for e in examples))
    reference = {
        "version": 1, "sheetId": floor["floorId"], "siteId": floor["jobId"],
        "targetPolicy": "physical-spaces",
        "source": {"pdfSha256": source["sha256"], "originalPageOneBased": page,
                   "pdf": {"path": f"pdfs/{source['sha256']}.pdf", "sha256": source["sha256"]}},
        "coordinateFrame": {"coordinates": "normalized-original-page", "width": floor["image"]["width"],
                            "height": floor["image"]["height"]},
        "rooms": [{**row, "kind": "room"} for row in approved], "rejected": rejections, "exclusions": [],
    }
    reference["review"] = {
        "scope": "complete-sheet" if complete_floor(floor) else "reviewed-subset",
        "reviewer": "Private export of app user review (user identity intentionally omitted)",
        "reviewedAt": stamp, "provenance": floor["reviewCompletenessProvenance"] +
            " Operator explicitly confirmed that the reviewed target was physical-spaces.",
        "pdfSha256": source["sha256"], "originalPageOneBased": page, "targetPolicy": "physical-spaces",
        "reviewedSnapshotSha256": snapshot_hash(reference),
    }
    review_scope(reference)
    return reference


def prepare(feedback_path, prediction_root, output, *, confirmed_target):
    pins = {}
    sources = {**source_hashes(), str(Path(__file__).resolve()): file_hash(Path(__file__).resolve())}
    payload = read_json(feedback_path, pins)
    if payload.get("version") != 2 or payload.get("target") != "physical-spaces":
        raise ValueError("Use immutable version-2 source-verified feedback")
    floors = payload.get("floors")
    if not isinstance(floors, list) or not isinstance(payload.get("examples"), list):
        raise ValueError("Feedback needs floor metadata and examples")
    seen = set()
    for floor in floors:
        ident, job = floor.get("floorId"), floor.get("jobId")
        if (not isinstance(ident, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", ident) or
                ident in seen or not isinstance(job, str) or floor.get("group") != job or
                floor.get("split") != job_split(job)):
            raise ValueError("Invalid or duplicate floor/job split metadata")
        seen.add(ident)
    # Quarantine an entire PDF when any job alias is held out, before source copying.
    protected_pdfs = {f.get("sourceDrawing", {}).get("sha256") for f in floors if f["split"] != "development"}
    eligible = [f for f in floors if f["split"] == "development" and
                f.get("sourceDrawing", {}).get("sha256") not in protected_pdfs]
    eligible_ids = {f["floorId"] for f in eligible}
    # No geometry helper sees holdout aliases; their source metadata is sufficient.
    filtered = {**payload, "floors": eligible,
                "examples": [e for e in payload["examples"] if e.get("floorId") in eligible_ids]}
    _, examples, stale = validate_export(filtered)
    staged, copied = [], {}
    for floor in eligible:
        if not examples[floor["floorId"]] and not complete_floor(floor):
            continue
        reference = reference_from_floor(floor, examples[floor["floorId"]], confirmed_target=confirmed_target)
        pdf_path = private_file(feedback_path.resolve().parent, floor["sourceDrawing"])
        pins[str(pdf_path)] = floor["sourceDrawing"]["sha256"]
        prediction_path = prediction_root / f"{floor['floorId']}.json"
        prediction = read_json(prediction_path, pins)
        score_case(reference, prediction)
        copied[f"pdfs/{file_hash(pdf_path)}.pdf"] = (pdf_path, file_hash(pdf_path))
        copied[f"predictions/{floor['floorId']}.json"] = (prediction_path.resolve(), pins[str(prediction_path.resolve())])
        staged.append(reference)
    if not staged:
        raise ValueError("No usable development review evidence; no reference or perfect score is fabricated")
    verify_pins({**pins, **sources})
    output.mkdir(mode=0o700)
    (output / "pdfs").mkdir(mode=0o700)
    (output / "predictions").mkdir(mode=0o700)
    emitted = {}
    for relative, (source, digest) in copied.items():
        destination = output / relative
        with destination.open("xb") as handle:
            handle.write(source.read_bytes())
        destination.chmod(0o600)
        if file_hash(destination) != digest:
            raise ValueError("Copied bytes changed")
        emitted[str(destination.resolve())] = digest
    cases = []
    for reference in staged:
        path = output / f"{reference['sheetId']}.reference.json"
        with path.open("x", encoding="utf-8") as handle:
            json.dump(reference, handle, indent=2, allow_nan=False)
            handle.write("\n")
        path.chmod(0o600)
        emitted[str(path.resolve())] = file_hash(path)
        prediction = f"predictions/{reference['sheetId']}.json"
        cases.append({"source": {k: reference["source"][k] for k in ("pdfSha256", "originalPageOneBased")},
                      "siteId": reference["siteId"], "split": "development",
                      "reference": {"path": path.name, "sha256": file_hash(path)},
                      "prediction": {"path": prediction, "sha256": emitted[str((output / prediction).resolve())]}})
    manifest = {"version": 1, "split": "development", "targetPolicy": "physical-spaces", "cases": cases,
                "feedbackExportSha256": pins[str(feedback_path.resolve())],
                "excludedStaleExamples": stale, "excludedHoldoutOrPdfAliasFloors": len(floors) - len(eligible),
                "sourceHashes": sources}
    path = output / "manifest.json"
    with path.open("x", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, allow_nan=False)
        handle.write("\n")
    path.chmod(0o600)
    emitted[str(path.resolve())] = file_hash(path)
    verify_pins({**pins, **sources, **emitted})
    with (output / "PREPARED.json").open("x", encoding="utf-8") as handle:
        json.dump({"inputHashes": pins, "sourceHashes": sources, "outputs": emitted}, handle, indent=2)
        handle.write("\n")
    (output / "PREPARED.json").chmod(0o600)
    verify_pins({**pins, **sources, **emitted})
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--feedback", type=Path, required=True)
    parser.add_argument("--predictions", type=Path, required=True,
                        help="Directory of version-1 FLOOR_ID.json saved prediction manifests")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--confirm-export-target", choices=["physical-spaces"], required=True)
    args = parser.parse_args()
    result = prepare(args.feedback, args.predictions, args.out, confirmed_target=args.confirm_export_target)
    print(f"Prepared {len(result['cases'])} source-bound development cases: {args.out / 'manifest.json'}")


if __name__ == "__main__":
    main()
