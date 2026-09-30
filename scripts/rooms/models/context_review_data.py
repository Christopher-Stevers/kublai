"""Append verified private reviews to an immutable context dataset.

This builder does not train or evaluate partially reviewed floors as complete.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys

import numpy as np
from PIL import Image

REPO = next(parent for parent in Path(__file__).resolve().parents
            if (parent / "scripts/rooms/models/common.py").is_file())
sys.path.insert(0, str(REPO / "scripts/rooms/models"))
from build_data import (FEEDBACK_ADAPTER, complete_floor, instance_masks, model_split,
                        private_file, reviewed_targets, shape_polygon, store_case,
                        validate_export, verified_review_floor)
from build_sheet_data import overview_targets
from common import canonical_hash, checked_asset, file_hash, private_dir, source_hashes, write_json
from context_predict import runtime_versions, verify_hashes
from context_train import read_context_manifest
from review_annotation import BOUNDARY_TOLERANCE_PIXELS, significant_room_overlaps


def fingerprints():
    return {"model_sources": source_hashes(), "feedback_adapter": file_hash(FEEDBACK_ADAPTER),
            "review_builder": file_hash(Path(__file__).resolve())}


def drawing_identity(floor):
    """Metadata only: protected source assets must never be resolved."""
    drawing = floor.get("sourceDrawing", {})
    digest, page = drawing.get("sha256"), drawing.get("pageNumber")
    if (drawing.get("kind") != "pdf" or not isinstance(digest, str) or
            not re.fullmatch(r"[a-f0-9]{64}", digest) or not isinstance(page, int) or
            isinstance(page, bool) or page < 1):
        raise ValueError("Every protected/admitted review requires explicit PDF hash and source page metadata")
    return digest, page


def copy_checked(source, destination, expected):
    if file_hash(source) != expected:
        raise RuntimeError("Frozen input changed before private copying")
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if destination.exists():
        if file_hash(destination) != expected:
            raise ValueError("Conflicting private copied asset")
    else:
        with destination.open("xb") as output:
            output.write(source.read_bytes())
        destination.chmod(0o600)
    verify_hashes({source: expected, destination: expected})


def build(args):
    sources, runtime = fingerprints(), runtime_versions()
    frozen = {path: file_hash(path) for path in (args.manifest, *args.feedback)}
    base = read_context_manifest(args.manifest)
    if any(record["source"] != "synthetic-msd" for record in base["records"]):
        raise ValueError("Supply the original frozen synthetic context manifest, not an accumulated review dataset")
    # Collect every protected PDF across every export before processing even the
    # first development floor. Different jobs, pages, previews or export order
    # cannot make a protected source packet eligible for model development.
    exports, protected_sources = [], set()
    for export in args.feedback:
        payload = json.loads(export.read_text())
        verify_hashes({export: frozen[export]})
        floors, evidence, stale = validate_export(payload)
        exports.append((export, floors, evidence, stale))
        protected_sources.update(drawing_identity(floor) for floor in floors if floor["split"] == "holdout")
    protected_pdfs = {digest for digest, _ in protected_sources}
    verify_hashes(frozen)
    private_dir(args.output)
    records = [dict(record) for record in base["records"]]
    for record in records:
        for key in ("image", "targets", "overview"):
            asset = checked_asset(args.manifest.parent, record[key], record[key + "_sha256"])
            frozen[asset] = record[key + "_sha256"]
            destination = (args.output / record[key]).resolve()
            if not destination.is_relative_to(args.output.resolve()):
                raise ValueError("Copied base asset escapes the new dataset")
            copy_checked(asset, destination, frozen[asset])
    copy_checked(args.manifest, args.output / "provenance/base-manifest.json", frozen[args.manifest])
    output_proofs = {args.output / "provenance/base-manifest.json": frozen[args.manifest]}
    counts = {"included": 0, "protected_jobs_skipped": 0, "no_verified_positive_skipped": 0,
              "protected_drawing_aliases_skipped": 0, "unverified_positive_rooms_skipped": 0, "stale_examples_ignored": 0,
              "overlapping_complete_floors_quarantined": 0}
    identifiers = {record["id"] for record in records}
    drawing_splits = {}
    quarantined_aliases = []
    quarantined_annotations = []
    for export, floors, evidence, stale in exports:
        counts["stale_examples_ignored"] += stale
        export_copy = "provenance/review-export-" + frozen[export] + ".json"
        copy_checked(export, args.output / export_copy, frozen[export])
        output_proofs[args.output / export_copy] = frozen[export]
        for floor in floors:
            # Skip protected jobs before even resolving their private assets.
            if floor["split"] == "holdout":
                counts["protected_jobs_skipped"] += 1
                continue
            if floor.get("sourceDrawing", {}).get("sha256") in protected_pdfs:
                counts["protected_drawing_aliases_skipped"] += 1
                quarantined_aliases.append({"job_id": floor["jobId"], "floor_id": floor["floorId"],
                    "drawing_sha256": floor["sourceDrawing"]["sha256"], "source_page": floor["sourceDrawing"].get("pageNumber")})
                continue
            if not floor["approvedRooms"]:
                counts["no_verified_positive_skipped"] += 1
                continue
            drawing, image_asset = floor.get("sourceDrawing", {}), floor.get("image", {})
            drawing_identity(floor)
            if (drawing.get("kind") != "pdf" or not isinstance(drawing.get("pageNumber"), int) or
                    isinstance(drawing.get("pageNumber"), bool) or drawing["pageNumber"] < 1 or
                    not drawing.get("provenance") or not image_asset.get("provenance")):
                raise ValueError("Reviews require exact copied PDF/page and explicit PDF/image preparation provenance")
            source, image_path = private_file(export.parent, drawing), private_file(export.parent, image_asset)
            frozen[source], frozen[image_path] = drawing["sha256"], image_asset["sha256"]
            verified = verified_review_floor(floor, evidence[floor["floorId"]], frozen[source])
            counts["unverified_positive_rooms_skipped"] += len(floor["approvedRooms"]) - len(verified["approvedRooms"])
            if not verified["approvedRooms"]:
                counts["no_verified_positive_skipped"] += 1
                continue
            group = f"reviewed-job:{floor['jobId']}"
            split = model_split(group)
            if drawing_splits.setdefault(frozen[source], split) != split:
                raise ValueError("One exact source PDF occurs in both training and validation despite different jobs/pages")
            ident = "review-" + hashlib.sha256(
                f"{floor['jobId']}:{floor['floorId']}:{frozen[source]}".encode()).hexdigest()[:20]
            if ident in identifiers:
                raise ValueError("One current reviewed floor cannot be repeated across exports")
            identifiers.add(ident)
            with Image.open(image_path) as raw:
                if raw.size != (image_asset.get("width"), image_asset.get("height")):
                    raise ValueError("Review image dimensions differ from its immutable snapshot")
                image = raw.convert("RGB")
            verify_hashes({source: frozen[source], image_path: frozen[image_path], export: frozen[export]})
            if complete_floor(verified):
                conflicts = significant_room_overlaps(
                    [(room["id"], shape_polygon(room["shape"])) for room in verified["approvedRooms"]], *image.size)
                if conflicts:
                    counts["overlapping_complete_floors_quarantined"] += 1
                    quarantined_annotations.append({"job_id": floor["jobId"], "floor_id": floor["floorId"],
                        "drawing_sha256": frozen[source], "conflicting_rooms": conflicts})
                    continue
            target, known = reviewed_targets(verified, *image.size)
            truth = instance_masks([shape_polygon(room["shape"]) for room in verified["approvedRooms"]],
                                   *image.size, lambda x, y: (x * image.width, y * image.height))
            coarse, coarse_known = overview_targets(target, known, base["overview"])
            source_copy = f"provenance/{frozen[source]}.pdf"
            image_copy = f"provenance/{frozen[image_path]}.image"
            copy_checked(source, args.output / source_copy, frozen[source])
            copy_checked(image_path, args.output / image_copy, frozen[image_path])
            output_proofs[args.output / source_copy] = frozen[source]
            output_proofs[args.output / image_copy] = frozen[image_path]
            record = store_case(args.output, ident, image, target, known, truth,
                site=group, group=group, split=split, source="reviewed-floor",
                job_id=floor["jobId"], floor_id=floor["floorId"], drawing_key=floor["drawingKey"],
                source_page=drawing["pageNumber"], drawing_hash=frozen[source],
                input_snapshot_hash=frozen[image_path], review_export_sha256=frozen[export],
                review_export_snapshot=export_copy, source_pdf_snapshot=source_copy, input_image_snapshot=image_copy,
                approved_room_ids=[room["id"] for room in verified["approvedRooms"]],
                review_evidence_sha256=canonical_hash(evidence[floor["floorId"]]),
                verified_floor_snapshot_sha256=canonical_hash(verified), completeness_attested=complete_floor(verified),
                full_space_evaluation_eligible=complete_floor(verified), negative_proposals_used_as_background=False,
                opening_supervision="unknown", limitations="Current verified approved outlines only; all unreviewed pixels unknown unless current completeness attested.")
            overview = args.output / f"{ident}-overview.npz"
            np.savez_compressed(overview, target=coarse, known=coarse_known)
            overview.chmod(0o600)
            record.update(overview=overview.name, overview_sha256=file_hash(overview))
            records.append(record)
            counts["included"] += 1
    # Frozen model pages keep their original splits; each new review job is
    # grouped, and identical image bytes cannot silently cross those splits.
    groups, images = {}, {}
    for record in records:
        if groups.setdefault(record["group"], record["split"]) != record["split"]:
            raise ValueError("One review job appears in both training and validation")
        if images.setdefault(record["image_sha256"], record["split"]) != record["split"]:
            raise ValueError("Identical image bytes cross training and validation")
        for key in ("image", "targets", "overview"):
            checked_asset(args.output, record[key], record[key + "_sha256"])
    verify_hashes(frozen)
    verify_hashes(output_proofs)
    if fingerprints() != sources or runtime_versions() != runtime:
        raise RuntimeError("Review builder source/runtime changed before manifest freeze")
    result = {**base, "records": records, "review_adapter": "verified-context-review-v1",
              "base_manifest_sha256": frozen[args.manifest], "base_manifest_snapshot": "provenance/base-manifest.json",
              "review_source_hashes": sources, "review_runtime": runtime, "feedback_counts": counts,
              "protected_review_sources": [{"drawing_sha256": digest, "source_page": page} for digest, page in sorted(protected_sources)],
              "excluded_review_pdf_sha256": sorted(protected_pdfs), "quarantined_review_aliases": quarantined_aliases,
              "quarantined_dense_annotations": quarantined_annotations,
              "dense_annotation_boundary_tolerance_pixels": BOUNDARY_TOLERANCE_PIXELS,
              "review_pdf_splits": drawing_splits,
              "source_input_hashes": {str(path.resolve()): digest for path, digest in frozen.items()},
              "provenance_snapshot_hashes": {str(path.relative_to(args.output)): digest for path, digest in output_proofs.items()},
              "limitations": "Private challenger data. Partial reviews do not support full-floor instance scores; all opening labels unknown. No protected review assets were read."}
    write_json(args.output / "manifest.json", result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--feedback", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    result = build(args)
    print(json.dumps(result["feedback_counts"]))


if __name__ == "__main__":
    main()
