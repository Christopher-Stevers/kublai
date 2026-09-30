"""Integrity and geometric tests: private feedback never fabricates completeness."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from PIL import Image, ImageDraw

from evaluate_feedback import (
    CONTRACT, REPO, canonical_hash, compare_reports, complete_floor, file_hash,
    full_metrics, job_split, partial_evidence, private_file, shape_polygon, validate_export,
)


def box(x=0.1, y=0.1, w=0.3, h=0.3):
    return {"type": "bbox", "x": x, "y": y, "w": w, "h": h}


def payload():
    job = "test-job"
    floor = {"floorId": "floor-1", "jobId": job, "group": job, "split": job_split(job),
             "drawingKey": "private-sheet:1", "floorStatus": "confirmed", "completenessReviewed": True,
             "completenessReviewedAt": "2026-09-30T11:59:00Z", "floorConfirmedAt": "2026-09-30T12:00:00Z",
             "reviewCompletenessProvenance": "explicit-user-attestation",
             "sourceReviewHash": "a" * 64, "sourceDrawing": {"sha256": "a" * 64},
             "approvedRooms": [{"id": "room-1", "shape": box()}]}
    example = {"id": "room-1", "floorId": "floor-1", "group": job, "split": job_split(job),
               "drawingKey": "private-sheet:1", "decision": "approved", "corrected": box(),
               "sourceVerified": True,
               "detection": {"drawingHash": "a" * 64}}
    return {"version": 2, "target": "physical-spaces", "floors": [floor], "examples": [example]}


class FeedbackIntegrityTests(unittest.TestCase):
    def test_holes_remain_background_and_do_not_merge_inner_room(self):
        outer = box(0.1, 0.1, 0.8, 0.8)
        shell = shape_polygon(outer)
        inner = shape_polygon(box(0.3, 0.3, 0.4, 0.4))
        points = lambda ring: [{"x": x, "y": y} for x, y in list(ring.coords)[:-1]]
        corridor = shape_polygon({"type": "polygon", "points": points(shell.exterior),
                                  "holes": [points(inner.exterior)]})
        metrics = full_metrics([corridor, inner], [corridor])
        self.assertEqual(metrics["expected"], 2)
        self.assertEqual(metrics["fn50"], 1)
        self.assertEqual(metrics["merge_candidates"], 0)
        self.assertAlmostEqual(metrics["matched_iou_sum"], 1)

    def test_unknown_spaces_are_never_counted_as_false_positives(self):
        approved = shape_polygon(box())
        unknown = shape_polygon(box(0.6, 0.1))
        partial = partial_evidence([approved], [], [approved, unknown])
        self.assertEqual(partial["recovered_reviewed_positive50"], 1)
        self.assertFalse(any("recall" in key or "f1" in key or "fp" in key for key in partial))

    def test_rejected_merged_proposal_is_quality_evidence_not_negative_pixels(self):
        left, right = shape_polygon(box(0.1, 0.1, 0.3, 0.3)), shape_polygon(box(0.4, 0.1, 0.3, 0.3))
        merged = shape_polygon(box(0.1, 0.1, 0.6, 0.3))
        evidence = partial_evidence([left, right], [merged], [left, right])
        self.assertEqual(evidence["recovered_reviewed_positive50"], 2)
        self.assertEqual(evidence["reviewed_rejected_proposals_reemitted65"], 0)
        reemitted = partial_evidence([left, right], [merged], [merged])
        self.assertEqual(reemitted["reviewed_rejected_proposals_reemitted65"], 1)

    def test_legacy_confirmation_cannot_establish_complete_ground_truth(self):
        floor = payload()["floors"][0]
        self.assertTrue(complete_floor(floor))
        for field in ("completenessReviewedAt", "floorConfirmedAt", "reviewCompletenessProvenance", "sourceReviewHash", "sourceDrawing"):
            changed = deepcopy(floor)
            changed.pop(field)
            self.assertFalse(complete_floor(changed))
        floor["floorConfirmedAt"] = "2026-09-30T11:00:00Z"
        self.assertFalse(complete_floor(floor))
        floor["floorConfirmedAt"] = "not-a-timestamp"
        self.assertFalse(complete_floor(floor))

    def test_stale_drawing_feedback_is_ignored_and_group_leakage_rejected(self):
        data = payload()
        data["examples"][0]["drawingKey"] = "replaced-sheet:1"
        _, evidence, stale = validate_export(data)
        self.assertEqual(evidence["floor-1"], [])
        self.assertEqual(stale, 1)
        data = payload()
        data["floors"][0]["split"] = "holdout" if data["floors"][0]["split"] == "development" else "development"
        with self.assertRaisesRegex(ValueError, "deterministic grouped split"):
            validate_export(data)

    def test_reviewed_source_hash_must_match_exported_source_hash(self):
        data = payload()
        data["floors"][0]["sourceDrawing"] = {"sha256": "a" * 64}
        data["examples"][0]["detection"] = {"drawingHash": "b" * 64}
        with self.assertRaisesRegex(ValueError, "different source drawing bytes"):
            validate_export(data)
        data["examples"][0]["detection"]["drawingHash"] = "a" * 64
        validate_export(data)
        data["floors"][0]["sourceReviewHash"] = "b" * 64
        self.assertFalse(complete_floor(data["floors"][0]))

    def test_unverified_reviews_cannot_enter_partial_geometric_evidence(self):
        data = payload()
        data["examples"][0]["sourceVerified"] = False
        with self.assertRaisesRegex(ValueError, "source-verified"):
            validate_export(data)
        data["examples"][0]["sourceVerified"] = True
        data["examples"][0]["detection"].pop("drawingHash")
        with self.assertRaisesRegex(ValueError, "original drawing SHA-256"):
            validate_export(data)

    def test_changed_assets_and_export_path_escapes_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image = root / "image.png"
            image.write_bytes(b"immutable image")
            asset = {"path": "image.png", "sha256": file_hash(image)}
            self.assertEqual(private_file(root, asset), image)
            image.write_bytes(b"changed image")
            with self.assertRaisesRegex(ValueError, "hash changed"):
                private_file(root, asset)
            with tempfile.TemporaryDirectory() as other_temporary:
                outside = Path(other_temporary) / "outside.txt"
                outside.write_bytes(b"outside")
                (root / "escape").symlink_to(outside)
                with self.assertRaisesRegex(ValueError, "escapes"):
                    private_file(root, {"path": "escape", "sha256": file_hash(outside)})

    def test_invalid_geometry_is_not_silently_repaired(self):
        with self.assertRaises(ValueError):
            shape_polygon(box(-0.1))
        with self.assertRaises(ValueError):
            shape_polygon({"type": "polygon", "points": [
                {"x": 0.1, "y": 0.1}, {"x": 0.9, "y": 0.9},
                {"x": 0.1, "y": 0.9}, {"x": 0.9, "y": 0.1}]})

    def test_comparison_requires_identical_ground_truth_and_flags_misses(self):
        good = full_metrics([shape_polygon(box())], [shape_polygon(box())])
        bad = full_metrics([shape_polygon(box())], [])
        report = {"contract": CONTRACT, "dataset_sha256": canonical_hash(payload()), "split": "development",
                  "input_mode": "production", "floor_ids": ["floor-1"], "source_hashes": {},
                  "all_space_summary": {**good, "failures": 0},
                  "cases": [{"floorId": "floor-1", "status": "ok", "metrics": good,
                             "review_evidence": {"reviewed_rejected_proposals_reemitted65": 0}}]}
        current = deepcopy(report)
        current["all_space_summary"] = {**bad, "failures": 0}
        current["cases"][0]["metrics"] = bad
        comparison = compare_reports(current, report)
        self.assertEqual(comparison["all_space_delta"]["fn50"], 1)
        self.assertIn("more missed rooms", comparison["regressions"][0]["reasons"])
        current["dataset_sha256"] = "changed ground truth"
        with self.assertRaisesRegex(ValueError, "dataset_sha256"):
            compare_reports(current, report)

    def test_holdout_requires_explicit_gate_before_reading_inputs(self):
        script = Path(__file__).with_name("evaluate_feedback.py")
        process = subprocess.run([sys.executable, str(script),
                                  "--export", "/nonexistent", "--output", "/nonexistent-output",
                                  "--split", "holdout"], capture_output=True, text=True)
        self.assertNotEqual(process.returncode, 0)
        self.assertIn("Holdout requires --allow-holdout", process.stderr)


class OfflineAdapterTests(unittest.TestCase):
    def test_preview_adapter_uses_no_reference_seeds_and_preserves_dimensions(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image = Image.new("RGB", (600, 400), "white")
            draw = ImageDraw.Draw(image)
            draw.rectangle((50, 50, 550, 350), outline="black", width=8)
            draw.line((300, 50, 300, 350), fill="black", width=8)
            image.save(root / "input.png")
            request = {"mode": "preview", "input": str(root / "input.png"), "output": str(root / "prediction.json")}
            (root / "request.json").write_text(json.dumps(request))
            subprocess.run(["node", "--max-old-space-size=768", "--import", "tsx",
                            "scripts/rooms/complete/feedback-predict.ts", str(root / "request.json")],
                           cwd=REPO, capture_output=True, text=True, check=True, timeout=60)
            result = json.loads((root / "prediction.json").read_text())
            self.assertEqual(result["diagnostic"]["extractedSeeds"], 0)
            self.assertEqual((result["diagnostic"]["width"], result["diagnostic"]["height"]), (600, 400))
            self.assertEqual(len(result["rooms"]), 2)

    def test_private_export_replay_distinguishes_complete_from_partial_floor(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            export = root / "export"
            export.mkdir()
            image = Image.new("RGB", (600, 400), "white")
            draw = ImageDraw.Draw(image)
            draw.rectangle((50, 50, 550, 350), outline="black", width=8)
            draw.line((300, 50, 300, 350), fill="black", width=8)
            image.save(export / "image.png")
            data = payload()
            floor = data["floors"][0]
            floor["image"] = {"path": "image.png", "sha256": file_hash(export / "image.png"),
                              "width": 600, "height": 400, "provenance": "Synthetic pipeline fixture"}
            floor["sourceDrawing"] = {**floor["image"], "kind": "image"}
            floor["sourceReviewHash"] = floor["image"]["sha256"]
            left, right = box(0.1, 0.15, 0.38, 0.7), box(0.52, 0.15, 0.38, 0.7)
            floor["approvedRooms"] = [{"id": "room-1", "shape": left}, {"id": "room-2", "shape": right}]
            data["examples"][0]["corrected"] = left
            data["examples"][0]["detection"]["drawingHash"] = floor["image"]["sha256"]
            second = deepcopy(data["examples"][0])
            second.update(id="room-2", corrected=right)
            data["examples"].append(second)
            manifest = export / "feedback.json"
            manifest.write_text(json.dumps(data))
            common = [sys.executable, str(Path(__file__).with_name("evaluate_feedback.py")),
                      "--export", str(export), "--input", "preview", "--split", floor["split"]]
            if floor["split"] == "holdout":
                common.append("--allow-holdout")
            subprocess.run([*common, "--output", str(root / "complete")], cwd=REPO,
                           capture_output=True, text=True, check=True, timeout=60)
            report = json.loads((root / "complete/report.json").read_text())
            self.assertEqual(report["all_space_summary"]["expected"], 2)
            self.assertEqual(report["all_space_summary"]["f1_50"], 1)
            floor.update(completenessReviewed=False, completenessReviewedAt=None)
            manifest.write_text(json.dumps(data))
            subprocess.run([*common, "--output", str(root / "partial")], cwd=REPO,
                           capture_output=True, text=True, check=True, timeout=60)
            report = json.loads((root / "partial/report.json").read_text())
            self.assertIsNone(report["all_space_summary"])
            self.assertEqual(report["review_evidence_summary"]["recovered_reviewed_positive50"], 2)

    def test_production_adapter_reads_exact_pdf_page_and_filters_unit_descriptions(self):
        # A generated test PDF is a pipeline fixture, not a room-detection dataset.
        from reportlab.pdfgen import canvas
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            pdf = canvas.Canvas(str(root / "source.pdf"), pagesize=(600, 400))
            pdf.setLineWidth(8)
            pdf.rect(50, 50, 500, 300)
            pdf.showPage()
            pdf.setLineWidth(8)
            pdf.rect(50, 50, 500, 300)
            pdf.line(300, 50, 300, 350)
            pdf.drawString(120, 200, "BEDROOM 2")
            pdf.drawString(400, 200, "2 BEDROOM")
            pdf.save()
            request = {"mode": "production", "input": str(root / "source.pdf"), "pageNumber": 2,
                       "output": str(root / "prediction.json")}
            (root / "request.json").write_text(json.dumps(request))
            subprocess.run(["node", "--max-old-space-size=768", "--import", "tsx",
                            "scripts/rooms/complete/feedback-predict.ts", str(root / "request.json")],
                           cwd=REPO, capture_output=True, text=True, check=True, timeout=120)
            result = json.loads((root / "prediction.json").read_text())
            self.assertEqual(result["diagnostic"]["extractedSeeds"], 1)
            self.assertEqual(result["diagnostic"]["width"], 5000)
            self.assertEqual(len(result["rooms"]), 2)


if __name__ == "__main__":
    unittest.main()
