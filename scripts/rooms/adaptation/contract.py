"""Replay verified reviews before adapting the fixed context checkpoint.

This is an offline development tool, never a production model selector.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image

MODELS = Path(__file__).resolve().parent.parent / "models"
sys.path.insert(0, str(MODELS))
from common import canonical_hash, checked_asset, file_hash, source_hashes
from context_review_data import drawing_identity, fingerprints
from context_train import read_context_manifest
from build_data import (complete_floor, instance_masks, model_split, reviewed_targets,
                        shape_polygon, validate_export, verified_review_floor)
from build_sheet_data import overview_targets
from review_annotation import significant_room_overlaps, BOUNDARY_TOLERANCE_PIXELS

BASE_SHA = "79c22af5e8b2faeac31c6b8b290d292dccc5d9c34db542474edaa79b951a4cac"
PARENT_SHA = "aaa9990485a71a93406bf84ed21871f20721b0981c069247928c379633dd8313"
PARENT_RUN_SHA = "df4d658b3091a7b743935764fcd6fe6621da8f799bd8f893deba31bc06a46b82"
PARENT_DIR = Path("/home/tim/datasets/foremanhq-room-detection/models/train-context-long-20260930")
CONFIG = dict(epochs=12, tile=512, batch=2, patches=4, lr=0.0001,
              context_weight=0.5, seed=20260930, threads=4)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def metadata_preflight(path, *, expected_base=BASE_SHA):
    """All protected PDF and split identities are checked before asset decoding."""
    digest = file_hash(path)
    data = json.loads(path.read_text())
    require(data.get("review_adapter") == "verified-context-review-v1", "Use the verified context review adapter")
    require(data.get("base_manifest_sha256") == expected_base, "Parent base manifest differs")
    require(data.get("review_source_hashes") == fingerprints(), "Review adapter sources changed; rebuild from current exports")
    root = path.parent
    base_path = checked_asset(root, data["base_manifest_snapshot"], expected_base)
    base = json.loads(base_path.read_text())
    require(base.get("experiment") == "whole-sheet-context-v2", "Unsupported context base")
    require(all(data.get(k) == base.get(k) for k in ("version", "experiment", "heads", "overview", "excluded_msd_sites")), "Top-level context contract differs from preserved base")
    original = {r["id"]: r for r in base["records"]}
    require(len(original) == len(base["records"]) and all(r["source"] == "synthetic-msd" for r in original.values()), "Base must contain unique synthetic records")
    records = data.get("records", [])
    require(isinstance(records, list) and len(records) <= 120, "Bounded base plus at most twenty reviewed floors required")
    identifiers, base_seen, groups, images = set(), set(), {}, {}
    reviews, exports = [], {}
    for record in records:
        ident = record["id"]
        require(ident not in identifiers, "Duplicate case identifier")
        identifiers.add(ident)
        split = record["split"]
        require(split in ("train", "validation"), "Protected split cannot enter adaptation")
        require(groups.setdefault(record["group"], split) == split, "A job/site crosses splits")
        require(images.setdefault(record["image_sha256"], split) == split, "Identical image crosses splits")
        if record["source"] == "synthetic-msd":
            require(original.get(ident) == record, "Synthetic replay rows/splits changed from parent")
            base_seen.add(ident)
        else:
            require(record["source"] == "reviewed-floor", "Only verified reviewed floors may be appended")
            require(record["group"] == f"reviewed-job:{record['job_id']}" and model_split(record["group"]) == split, "Review job split differs from adapter")
            require(record.get("negative_proposals_used_as_background") is False and record.get("opening_supervision") == "unknown", "Rejections/openings cannot become segmentation negatives")
            require(bool(record.get("approved_room_ids")), "Reviewed case has no positive rooms")
            name, sha = record["review_export_snapshot"], record["review_export_sha256"]
            require(exports.setdefault(name, sha) == sha, "One export has conflicting hashes")
            reviews.append(record)
    require(base_seen == set(original), "Missing parent synthetic replay records")
    require([r for r in records if r["source"] == "synthetic-msd"] == base["records"], "Synthetic replay order changed")
    require(0 < len(reviews) <= 20, "Adaptation needs reviewed positives, at most twenty floors")
    require(all(any(r["split"] == split for r in reviews) for split in ("train", "validation")), "Reviewed training and separate reviewed validation jobs are both required")
    # Include every copied export, even one with only protected/skipped floors.
    for name, sha in data.get("provenance_snapshot_hashes", {}).items():
        if name.startswith("provenance/review-export-") and name.endswith(".json"):
            require(exports.setdefault(name, sha) == sha, "Export provenance hash differs")
    require(bool(exports), "Copied review exports are required")
    nonexports = {expected_base}
    nonexports.update(r[k + "_sha256"] for r in base["records"] for k in ("image", "targets", "overview"))
    nonexports.update(r[k] for r in reviews for k in ("drawing_hash", "input_snapshot_hash"))
    require(set(data.get("source_input_hashes", {}).values()) - nonexports == set(exports.values()), "Copied export inventory differs from frozen source inputs")
    floor_index, protected, protected_pages, payloads = {}, set(), set(), {}
    for name, sha in exports.items():
        exported = checked_asset(root, name, sha)
        floors, evidence, _ = validate_export(json.loads(exported.read_text()))
        payloads[name] = evidence
        for floor in floors:
            pdf, page = drawing_identity(floor)
            if floor["split"] == "holdout":
                protected.add(pdf)
                protected_pages.add((pdf, page))
            key = (name, floor["jobId"], floor["floorId"])
            require(key not in floor_index, "Duplicate current export floor")
            floor_index[key] = floor
    require(set(data.get("excluded_review_pdf_sha256", [])) == protected, "Declared protected PDFs differ from copied exports")
    require({(r["drawing_sha256"], r["source_page"]) for r in data.get("protected_review_sources", [])} == protected_pages, "Declared protected pages differ from copied exports")
    pdf_splits, pages, review_groups = {}, set(), {"train": set(), "validation": set()}
    for record in reviews:
        key = (record["review_export_snapshot"], record["job_id"], record["floor_id"])
        require(key in floor_index, "Review row is missing from copied export")
        floor = floor_index[key]
        pdf, page = drawing_identity(floor)
        require(floor["split"] != "holdout" and pdf not in protected, "A protected PDF alias entered adaptation")
        require(pdf == record["drawing_hash"] and page == record["source_page"], "Drawing/page identity differs")
        require((pdf, page) not in pages, "Duplicate reviewed PDF/page alias")
        pages.add((pdf, page))
        require(pdf_splits.setdefault(pdf, record["split"]) == record["split"], "One source PDF crosses model splits")
        require(record["drawing_key"] == floor["drawingKey"], "Drawing key differs")
        require(record["input_snapshot_hash"] == floor["image"]["sha256"], "Copied preview differs from exported approval input")
        require(all(data["provenance_snapshot_hashes"].get(record[k]) == record[h] for k, h in (("input_image_snapshot", "input_snapshot_hash"), ("source_pdf_snapshot", "drawing_hash"), ("review_export_snapshot", "review_export_sha256"))), "Review snapshots differ from frozen provenance inventory")
        review_groups[record["split"]].add(record["group"])
    require(all(review_groups.values()), "Reviewed training and separate reviewed validation jobs are both required")
    require(file_hash(path) == digest, "Manifest changed during metadata preflight")
    return data, base, reviews, floor_index, payloads


def preflight(path, *, expected_base=BASE_SHA):
    data, base, reviews, floors, evidence = metadata_preflight(path, expected_base=expected_base)
    root = path.parent
    frozen = {path.resolve(): file_hash(path)}
    for name, sha in data["provenance_snapshot_hashes"].items():
        asset = checked_asset(root, name, sha)
        frozen[asset] = sha
    for record in data["records"]:
        for key in ("image", "targets", "overview"):
            asset = checked_asset(root, record[key], record[key + "_sha256"])
            frozen[asset] = record[key + "_sha256"]
    for record in reviews:
        name = record["review_export_snapshot"]
        floor = floors[(name, record["job_id"], record["floor_id"])]
        source = checked_asset(root, record["source_pdf_snapshot"], record["drawing_hash"])
        image_path = checked_asset(root, record["input_image_snapshot"], record["input_snapshot_hash"])
        frozen[source], frozen[image_path] = record["drawing_hash"], record["input_snapshot_hash"]
        examples = evidence[name][record["floor_id"]]
        verified = verified_review_floor(floor, examples, record["drawing_hash"])
        require(canonical_hash(examples) == record["review_evidence_sha256"], "Review evidence differs")
        require(canonical_hash(verified) == record["verified_floor_snapshot_sha256"], "Approved snapshot differs")
        require([r["id"] for r in verified["approvedRooms"]] == record["approved_room_ids"], "Current approvals differ")
        dense = complete_floor(verified)
        require(dense is record["completeness_attested"] and dense is record["full_space_evaluation_eligible"], "Completeness claims differ")
        with Image.open(image_path) as raw:
            require(raw.width * raw.height <= 30_000_000, "Review exceeds native pixel budget")
            require(raw.size == (floor["image"]["width"], floor["image"]["height"]), "Review image dimensions differ")
            pixels = np.asarray(raw.convert("RGB"))
        with Image.open(root / record["image"]) as copied:
            require(np.array_equal(pixels, np.asarray(copied.convert("RGB"))), "Training pixels differ from verified input")
        if dense:
            overlaps = significant_room_overlaps([(r["id"], shape_polygon(r["shape"])) for r in verified["approvedRooms"]], pixels.shape[1], pixels.shape[0])
            require(not overlaps, "Overlapping dense rooms cannot establish supervision")
        target, known = reviewed_targets(verified, pixels.shape[1], pixels.shape[0])
        truth = instance_masks([shape_polygon(r["shape"]) for r in verified["approvedRooms"]], pixels.shape[1], pixels.shape[0], lambda x, y: (x * pixels.shape[1], y * pixels.shape[0]))
        coarse, coarse_known = overview_targets(target, known, data["overview"])
        with np.load(root / record["targets"], allow_pickle=False) as arrays:
            require(all(np.array_equal(arrays[k], v) for k, v in (("target", target), ("known", known), ("truth", truth))), "Review targets/masks differ from regenerated approvals")
        with np.load(root / record["overview"], allow_pickle=False) as arrays:
            require(np.array_equal(arrays["target"], coarse) and np.array_equal(arrays["known"], coarse_known), "Review overview differs from regenerated masks")
        require(bool((target[0] * known[0]).any()) and not known[2].any(), "Known reviewed positive is required; openings remain unknown")
    require(data.get("dense_annotation_boundary_tolerance_pixels") == BOUNDARY_TOLERANCE_PIXELS, "Dense boundary policy changed")
    require(read_context_manifest(path)["records"] == data["records"], "Context manifest changed")
    for asset, sha in frozen.items():
        require(file_hash(asset) == sha, "Input changed during provenance replay")
    return data, reviews, frozen


def verify(frozen):
    for path, sha in frozen.items():
        if file_hash(Path(path)) != sha:
            raise RuntimeError(f"Frozen input changed: {Path(path).name}")


def adaptation_weights(records, patches):
    """Half of each epoch's probability mass belongs to verified review tiles."""
    counts = {kind: sum(r["source"] == kind for r in records) for kind in ("synthetic-msd", "reviewed-floor")}
    require(all(counts.values()), "Synthetic replay and reviewed training positives are required")
    return [0.5 / (counts[r["source"]] * patches) for r in records for _ in range(patches)]
