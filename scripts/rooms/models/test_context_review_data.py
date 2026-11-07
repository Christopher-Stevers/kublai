"""Only fabricated reviews/assets; never reads an actual customer export."""
import json
from copy import deepcopy
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

import context_review_data as adapter
from build_data import model_split
from common import file_hash
from context_train import read_context_manifest
from evaluate_feedback import job_split
from test_context import context_fixture


def fixture(root, complete=False, protected=False):
    base = root / "base"
    base.mkdir()
    manifest, _ = context_fixture(base)
    export_dir = root / "review"
    export_dir.mkdir()
    source, image = export_dir / "source.pdf", export_dir / "page.png"
    source.write_bytes(b"%PDF-1.7 fabricated source; exact immutable fixture bytes")
    Image.new("RGB", (100, 100), (254, 254, 254)).save(image)
    digest = file_hash(source)
    job = next(f"fixture-job-{index}" for index in range(100) if
               (job_split(f"fixture-job-{index}") == "holdout") == protected)
    shape = {"type": "bbox", "x": .2, "y": .2, "w": .2, "h": .2}
    floor = {"jobId": job, "floorId": "floor-1", "group": job, "split": job_split(job),
        "drawingKey": "fixture-sheet:1", "approvedRooms": [{"id": "approved-room", "shape": shape}],
        "sourceDrawing": {"path": "source.pdf", "sha256": digest, "kind": "pdf", "pageNumber": 1,
                          "provenance": "Exact privately copied source PDF fixture."},
        "image": {"path": "page.png", "sha256": file_hash(image), "width": 100, "height": 100,
                  "provenance": "Native source PDF preview fixture."},
        "completenessReviewed": complete, "floorStatus": "confirmed" if complete else "detected",
        "sourceReviewHash": digest if complete else None,
        "reviewCompletenessProvenance": "Current explicit complete-floor review." if complete else None,
        "completenessReviewedAt": "2026-09-30T11:59:00Z" if complete else None,
        "floorConfirmedAt": "2026-09-30T12:00:00Z" if complete else None}
    evidence = {"id": "approved-room", "floorId": "floor-1", "group": job, "split": job_split(job),
        "drawingKey": floor["drawingKey"], "decision": "approved", "corrected": shape,
        "sourceVerified": True, "sourceReviewHash": digest, "detection": {"drawingHash": digest}}
    rejection = {**evidence, "id": "rejected-merge", "decision": "rejected", "corrected": None,
                 "proposal": {"type": "bbox", "x": .1, "y": .1, "w": .8, "h": .8}}
    payload = {"version": 2, "target": "physical-spaces", "floors": [floor], "examples": [evidence, rejection]}
    export = export_dir / "feedback.json"
    export.write_text(json.dumps(payload))
    return SimpleNamespace(manifest=manifest, feedback=[export], output=root / "output"), payload


def alias_payload(payload, job, suffix, page):
    result = deepcopy(payload)
    floor = result["floors"][0]
    floor.update(jobId=job, group=job, split=job_split(job), floorId=f"floor-{suffix}")
    floor["sourceDrawing"]["pageNumber"] = page
    for room in floor["approvedRooms"]:
        room["id"] += suffix
    for example in result["examples"]:
        example.update(id=example["id"] + suffix, floorId=floor["floorId"], group=job, split=job_split(job))
    return result


class ReviewAdapterTests(unittest.TestCase):
    def test_partial_verified_room_has_boundary_negatives_and_unknown_rejected_region(self):
        with tempfile.TemporaryDirectory() as temporary:
            args, _ = fixture(Path(temporary))
            result = adapter.build(args)
            reviewed = result["records"][-1]
            with np.load(args.output / reviewed["targets"]) as arrays:
                target, known = arrays["target"], arrays["known"]
            self.assertEqual(target[0, 30, 30], 1)
            self.assertEqual(target[1, 30, 30], 0)
            self.assertEqual(known[1, 30, 30], 1)
            self.assertTrue(np.all(known[:, 70, 70] == 0))
            self.assertEqual(known[2].sum(), 0)
            with np.load(args.output / reviewed["overview"]) as arrays:
                self.assertEqual(arrays["known"][2].sum(), 0)
                self.assertTrue(np.all(arrays["known"][:, 25, 25] == 0))
            self.assertFalse(reviewed["completeness_attested"])
            self.assertFalse(reviewed["full_space_evaluation_eligible"])
            self.assertFalse(reviewed["negative_proposals_used_as_background"])
            self.assertEqual((args.output / reviewed["source_pdf_snapshot"]).read_bytes(),
                             (args.feedback[0].parent / "source.pdf").read_bytes())
            self.assertEqual(read_context_manifest(args.output / "manifest.json")["records"], result["records"])

    def test_base_assets_are_exact_private_copies_and_validation_split_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            args, _ = fixture(root)
            original = json.loads(args.manifest.read_text())
            result = adapter.build(args)
            self.assertEqual(result["records"][0], original["records"][0])
            for key in ("image", "targets", "overview"):
                self.assertEqual((args.output / original["records"][0][key]).read_bytes(),
                                 (args.manifest.parent / original["records"][0][key]).read_bytes())
            self.assertEqual(args.output.stat().st_mode & 0o777, 0o700)
            self.assertEqual((args.output / "manifest.json").stat().st_mode & 0o777, 0o600)

    def test_protected_review_job_is_skipped_before_private_asset_resolution(self):
        with tempfile.TemporaryDirectory() as temporary:
            args, payload = fixture(Path(temporary), protected=True)
            payload["floors"][0]["image"]["path"] = "does-not-exist.png"
            payload["floors"][0]["sourceDrawing"]["path"] = "does-not-exist.pdf"
            args.feedback[0].write_text(json.dumps(payload))
            with patch.object(adapter, "private_file") as private:
                result = adapter.build(args)
            private.assert_not_called()
            self.assertEqual(result["feedback_counts"]["protected_jobs_skipped"], 1)
            self.assertEqual(result["feedback_counts"]["included"], 0)

    def test_stale_approval_shape_or_source_cannot_teach_room_perimeter(self):
        for change in ("shape", "source"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as temporary:
                args, payload = fixture(Path(temporary))
                if change == "shape":
                    payload["examples"][0]["corrected"] = {"type": "bbox", "x": .2, "y": .2, "w": .3, "h": .2}
                else:
                    payload["examples"][0]["sourceReviewHash"] = "b" * 64
                args.feedback[0].write_text(json.dumps(payload))
                result = adapter.build(args)
                self.assertEqual(result["feedback_counts"]["included"], 0)
                self.assertEqual(result["feedback_counts"]["unverified_positive_rooms_skipped"], 1)

    def test_current_completeness_enables_dense_first_heads_but_no_opening_labels(self):
        with tempfile.TemporaryDirectory() as temporary:
            args, _ = fixture(Path(temporary), complete=True)
            result = adapter.build(args)
            reviewed = result["records"][-1]
            with np.load(args.output / reviewed["targets"]) as arrays:
                self.assertTrue(np.all(arrays["known"][:2] == 1))
                self.assertEqual(arrays["known"][2].sum(), 0)
                self.assertEqual(arrays["target"][0, 70, 70], 0)
            self.assertTrue(reviewed["full_space_evaluation_eligible"])

    def test_input_mutation_after_decode_aborts_before_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            args, _ = fixture(Path(temporary))
            original = adapter.reviewed_targets
            def mutate(*values):
                (args.feedback[0].parent / "source.pdf").write_bytes(b"replaced PDF after image decode")
                return original(*values)
            with patch.object(adapter, "reviewed_targets", side_effect=mutate):
                with self.assertRaisesRegex(RuntimeError, "Frozen input changed"):
                    adapter.build(args)
            self.assertFalse((args.output / "manifest.json").exists())

    def test_protected_pdf_aliases_on_other_pages_are_quarantined_before_assets(self):
        for separate_export in (False, True):
            with self.subTest(separate_export=separate_export), tempfile.TemporaryDirectory() as temporary:
                args, payload = fixture(Path(temporary))
                job = next(f"protected-alias-{index}" for index in range(100) if job_split(f"protected-alias-{index}") == "holdout")
                protected = alias_payload(payload, job, "protected", 2)
                protected["floors"][0]["sourceDrawing"]["path"] = "never-resolve.pdf"
                protected["floors"][0]["image"]["path"] = "never-resolve.png"
                if separate_export:
                    later = args.feedback[0].with_name("later-export.json")
                    later.write_text(json.dumps(protected))
                    args.feedback.append(later)
                else:
                    payload["floors"].extend(protected["floors"])
                    payload["examples"].extend(protected["examples"])
                    args.feedback[0].write_text(json.dumps(payload))
                with patch.object(adapter, "private_file") as private:
                    result = adapter.build(args)
                private.assert_not_called()
                self.assertEqual(result["feedback_counts"]["included"], 0)
                self.assertEqual(result["feedback_counts"]["protected_drawing_aliases_skipped"], 1)
                self.assertEqual(result["protected_review_sources"][0]["source_page"], 2)
                self.assertEqual(len(result["excluded_review_pdf_sha256"]), 1)

    def test_same_pdf_different_jobs_pages_previews_cannot_cross_model_splits(self):
        with tempfile.TemporaryDirectory() as temporary:
            args, payload = fixture(Path(temporary))
            first_job = payload["floors"][0]["jobId"]
            first_split = model_split(f"reviewed-job:{first_job}")
            other_job = next(f"development-alias-{index}" for index in range(100) if
                job_split(f"development-alias-{index}") == "development" and
                model_split(f"reviewed-job:development-alias-{index}") != first_split)
            other = alias_payload(payload, other_job, "other", 2)
            image = args.feedback[0].parent / "different-preview.png"
            Image.new("RGB", (100, 100), (251, 252, 253)).save(image)
            other["floors"][0]["image"].update(path=image.name, sha256=file_hash(image))
            payload["floors"].extend(other["floors"])
            payload["examples"].extend(other["examples"])
            args.feedback[0].write_text(json.dumps(payload))
            with self.assertRaisesRegex(ValueError, "exact source PDF.*training and validation"):
                adapter.build(args)
            self.assertFalse((args.output / "manifest.json").exists())


if __name__ == "__main__":
    unittest.main()
