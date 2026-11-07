"""Fabricated polygons/bytes only. No customer drawing, database or detector runs."""
import copy
import json
from pathlib import Path
import tempfile
import shutil
import unittest
from unittest.mock import patch

import score
import prepare_feedback
import wrap_trial

SHA = "a" * 64


def rectangle(ident, x, y, w, h, **extra):
    return {"id": ident, "kind": "room", "shape": {"type": "polygon", "points": [
        {"x": x, "y": y}, {"x": x+w, "y": y}, {"x": x+w, "y": y+h}, {"x": x, "y": y+h}]}, **extra}


def seal(reference, scope="complete-sheet"):
    reference["review"] = {"scope": scope, "reviewer": "Fabricated test reviewer", "provenance": "Fabricated complete/subset review",
                           "reviewedAt": "2026-10-02T12:00:00Z", "pdfSha256": reference["source"]["pdfSha256"],
                           "originalPageOneBased": reference["source"]["originalPageOneBased"],
                           "targetPolicy": reference["targetPolicy"], "reviewedSnapshotSha256": score.snapshot_hash(reference)}
    return reference


def fixture(rooms=None):
    reference = seal({"version": 1, "sheetId": "fabricated", "siteId": "site-a", "targetPolicy": "physical-spaces",
        "source": {"pdfSha256": SHA, "originalPageOneBased": 18},
        "coordinateFrame": {"coordinates": "normalized-original-page", "width": 1000, "height": 500},
        "rooms": rooms if rooms is not None else [rectangle("room-a", .1, .1, .2, .2, name="A 101")],
        "exclusions": [], "rejected": []})
    prediction = {k: copy.deepcopy(reference[k]) for k in ("version", "sheetId", "targetPolicy", "source", "coordinateFrame", "rooms")}
    prediction.update(status="completed", producer={"name": "fabricated", "sourceSha256": SHA, "configSha256": SHA},
                      execution={"elapsedMs": 3, "peakRssBytes": 1000})
    return reference, prediction


class GeometryScores(unittest.TestCase):
    def test_exact_complete_match_names_and_boundaries(self):
        ref, pred = fixture()
        pred["rooms"][0]["name"] = " a   101 "
        result = score.score_case(ref, pred, boundaries=True)
        self.assertEqual(result["wholeSheetMetrics"]["recall50"], 1)
        self.assertEqual(result["naming"]["accuracy"], 1)
        self.assertEqual(result["boundary"]["maximum"], 0)

    def test_one_to_one_merge_and_split(self):
        ref, pred = fixture([rectangle("a", .1, .1, .2, .2), rectangle("b", .3, .1, .2, .2)])
        pred["rooms"] = [rectangle("merged", .1, .1, .4, .2)]
        result = score.score_case(ref, pred)["wholeSheetMetrics"]
        self.assertEqual((result["tp50"], result["misses50"], result["bleedCandidates"]), (1, 1, 1))
        ref, pred = fixture([rectangle("a", .1, .1, .4, .2)])
        pred["rooms"] = [rectangle("left", .1, .1, .2, .2), rectangle("right", .3, .1, .2, .2)]
        result = score.score_case(ref, pred)["wholeSheetMetrics"]
        self.assertEqual((result["tp50"], result["extras50"], result["splitCandidates"]), (1, 1, 1))

    def test_failure_counts_every_nonempty_complete_reference_as_missed(self):
        ref, pred = fixture()
        pred.update(status="failed", rooms=[], error="fabricated timeout")
        result = score.score_case(ref, pred)
        summary = score.summarize([result])
        self.assertEqual(summary["detectorFailures"], 1)
        self.assertEqual(summary["wholeSheetMetrics"]["misses50"], 1)
        self.assertEqual(summary["wholeSheetMetrics"]["recall50"], 0)

    def test_partial_unknown_candidates_never_become_junk_or_global_recall(self):
        ref, pred = fixture()
        seal(ref, "reviewed-subset")
        pred["rooms"].append(rectangle("unknown", .6, .6, .1, .1))
        result = score.score_case(ref, pred)
        self.assertIsNone(result["wholeSheetMetrics"])
        self.assertEqual(result["reviewedEvidence"]["recovered50"], 1)
        self.assertIsNone(score.summarize([result])["wholeSheetMetrics"])

    def test_zero_positive_truth_never_reports_perfection_including_complete_scope(self):
        for scope in ("complete-sheet", "reviewed-subset"):
            ref, pred = fixture([])
            seal(ref, scope)
            result = score.score_case(ref, pred)
            self.assertIsNone(result["wholeSheetMetrics"])
            self.assertIsNone(result["naming"]["accuracy"])
            self.assertEqual(result["referenceStatus"], "insufficient-positive-reference")

    def test_rejections_are_evidence_not_background_ground_truth(self):
        ref, pred = fixture([])
        ref["rejected"] = [rectangle("rejected", .1, .1, .2, .2, reviewReason="not-space")]
        seal(ref, "reviewed-subset")
        pred["rooms"] = [rectangle("new-id", .1, .1, .2, .2)]
        result = score.score_case(ref, pred)
        self.assertEqual(result["reviewedEvidence"]["reemittedRejectedProposals"], 1)
        self.assertIsNone(result["wholeSheetMetrics"])

    def test_boundary_fix_at_point_eight_iou_is_not_space_only_negative(self):
        for reason, count in (("boundary", 0), ("merged", 0), ("split", 0), (None, 0), ("not-space", 1)):
            ref, pred = fixture([])
            ref["rejected"] = [rectangle("rejected", .1, .1, .2, .2, reviewReason=reason)]
            seal(ref, "reviewed-subset")
            pred["rooms"] = [rectangle("boundary-fixed", .1, .1, .16, .2)]
            result = score.score_case(ref, pred)
            self.assertEqual(result["reviewedEvidence"]["reemittedRejectedProposals"], count)
            self.assertEqual(result["reviewedEvidence"]["rejections"][0]["iouThreshold"], .65 if reason == "not-space" else .98)

    def test_exclusions_subtract_both_sides_and_report_ignored_and_clipped(self):
        ref, pred = fixture()
        ref["exclusions"] = [rectangle("ignore", .2, .1, .6, .2)]
        pred["rooms"].append(rectangle("fully-ignored", .5, .15, .1, .1))
        seal(ref)
        result = score.score_case(ref, pred)
        self.assertEqual(result["excludedPredictionIds"], ["fully-ignored"])
        self.assertAlmostEqual(result["exclusionMasking"]["reference"][0]["fractionRemoved"], .5)
        self.assertEqual(result["wholeSheetMetrics"]["extras50"], 0)

    def test_holes_are_kept_and_filling_hole_lowers_iou(self):
        ref, pred = fixture([rectangle("ring", .1, .1, .8, .8)])
        hole = rectangle("hole", .2, .2, .6, .6)["shape"]["points"]
        ref["rooms"][0]["shape"]["holes"] = [hole]
        seal(ref)
        result = score.score_case(ref, pred)
        self.assertEqual(result["wholeSheetMetrics"]["misses50"], 1)
        self.assertIn("fill-rule=\"evenodd\"", score.overlay(ref, pred, result))

    def test_optional_name_coverage_is_only_named_matches(self):
        ref, pred = fixture()
        ref["rooms"][0]["nameAliases"] = ["Suite A101"]
        pred["rooms"][0]["name"] = "Suite A101"
        seal(ref)
        self.assertEqual(score.score_case(ref, pred)["naming"]["accuracy"], 1)


class Contracts(unittest.TestCase):
    def test_policy_source_page_frame_and_attestation_mismatches_fail(self):
        ref, pred = fixture()
        mutations = [lambda r, p: p.update(targetPolicy="units-and-common"),
                     lambda r, p: p["source"].update(originalPageOneBased=19),
                     lambda r, p: p["source"].update(pdfSha256="b"*64),
                     lambda r, p: p["coordinateFrame"].update(width=2000),
                     lambda r, p: r["source"].update(originalPageIndex=18),
                     lambda r, p: r["review"].update(reviewedSnapshotSha256="c"*64),
                     lambda r, p: r["review"].update(reviewedAt="2026-10-02"),
                     lambda r, p: r["rooms"][0].update(kind="unit"),
                     lambda r, p: p["execution"].update(elapsedMs=float("nan"))]
        for mutate in mutations:
            r, p = copy.deepcopy(ref), copy.deepcopy(pred)
            mutate(r, p)
            with self.assertRaises(ValueError):
                score.score_case(r, p)

    def test_target_policy_units_is_supported_without_physical_relabel(self):
        ref, pred = fixture()
        ref["targetPolicy"] = pred["targetPolicy"] = "units-and-common"
        ref["rooms"][0]["kind"] = "unit"
        seal(ref)
        self.assertEqual(score.score_case(ref, pred)["wholeSheetMetrics"]["recall50"], 1)

    def test_invalid_overlapping_reference_and_duplicate_proposals_fail(self):
        ref, pred = fixture()
        ref["rooms"].append(rectangle("nested", .15, .15, .05, .05))
        seal(ref)
        with self.assertRaisesRegex(ValueError, "overlap"):
            score.score_case(ref, pred)
        ref, pred = fixture()
        pred["rooms"].append(copy.deepcopy(pred["rooms"][0]))
        with self.assertRaisesRegex(ValueError, "unique"):
            score.score_case(ref, pred)

    def test_complete_reference_cannot_be_changed_without_new_review(self):
        ref, pred = fixture()
        ref["exclusions"] = [rectangle("new-mask", 0, 0, .1, .1)]
        with self.assertRaisesRegex(ValueError, "changed after"):
            score.score_case(ref, pred)

    def test_empty_failure_cannot_credit_partial_outputs(self):
        ref, pred = fixture()
        pred.update(status="failed", error="failed")
        with self.assertRaisesRegex(ValueError, "no credited"):
            score.score_case(ref, pred)


def write_fixture(root):
    ref, pred = fixture()
    pdf = root / "source.pdf"
    pdf.write_bytes(b"%PDF-1.7 fabricated bytes; never decoded\n")
    digest = score.file_hash(pdf)
    ref["source"] = {"pdfSha256": digest, "originalPageOneBased": 18,
                     "pdf": {"path": "source.pdf", "sha256": digest}}
    pred["source"] = {"pdfSha256": digest, "originalPageOneBased": 18}
    seal(ref)
    for name, payload in (("reference.json", ref), ("prediction.json", pred)):
        (root / name).write_text(json.dumps(payload))
    manifest = {"version": 1, "split": "development", "targetPolicy": "physical-spaces", "cases": [
        {"source": pred["source"], "siteId": ref["siteId"], "split": "development",
         "reference": {"path": "reference.json", "sha256": score.file_hash(root / "reference.json")},
         "prediction": {"path": "prediction.json", "sha256": score.file_hash(root / "prediction.json")}}]}
    path = root / "manifest.json"
    path.write_text(json.dumps(manifest))
    return path


class OfflineEvidence(unittest.TestCase):
    def test_fabricated_end_to_end_outputs_and_pins(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = write_fixture(root)
            out = root / "out"
            result = score.evaluate(path, out, boundaries=True)
            self.assertEqual(result["summary"]["completeNonemptyCases"], 1)
            receipt = json.loads((out / "COMPLETED.json").read_text())
            score.verify_pins(receipt["outputs"])
            self.assertEqual(score.read_completed(out)["cases"][0]["expected"], 1)
            self.assertEqual(receipt["outputDirectory"], str(out))
            self.assertEqual((out / "report.json").stat().st_mode & 0o777, 0o600)

    def test_holdout_duplicate_pdf_page_and_alias_block_before_reference_decode(self):
        for change in ("holdout", "duplicate", "alias"):
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                path = write_fixture(root)
                payload = json.loads(path.read_text())
                if change == "holdout":
                    payload["cases"][0]["split"] = "holdout"
                else:
                    extra = copy.deepcopy(payload["cases"][0])
                    if change == "alias":
                        extra["source"]["originalPageOneBased"] = 19
                        extra["siteId"] = "another-site"
                    payload["cases"].append(extra)
                payload["cases"][0]["reference"]["path"] = "does-not-exist.json"
                path.write_text(json.dumps(payload))
                with self.assertRaises(ValueError):
                    score.evaluate(path, root / "out")

    def test_changed_pdf_or_reference_hash_is_rejected(self):
        for name in ("source.pdf", "reference.json"):
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                path = write_fixture(root)
                with (root / name).open("ab") as h:
                    h.write(b" ")
                with self.assertRaises(ValueError):
                    score.evaluate(path, root / "out")

    def test_late_input_or_overlay_mutation_never_completes(self):
        for target in ("input", "overlay"):
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                path = write_fixture(root)
                original = score.verify_pins
                count = 0
                def drift(pins):
                    nonlocal count
                    count += 1
                    if count == 2:
                        victim = root / "source.pdf" if target == "input" else root / "out/sheet-000.svg"
                        with victim.open("ab") as h:
                            h.write(b" ")
                    original(pins)
                with patch.object(score, "verify_pins", side_effect=drift), self.assertRaises(ValueError):
                    score.evaluate(path, root / "out")
                self.assertFalse((root / "out/COMPLETED.json").exists())

    def test_copied_or_changed_completed_outputs_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = write_fixture(root)
            score.evaluate(path, root / "out")
            shutil.copytree(root / "out", root / "copy")
            with self.assertRaisesRegex(ValueError, "different original"):
                score.read_completed(root / "copy")
            with (root / "out/sheet-000.svg").open("ab") as h:
                h.write(b" ")
            with self.assertRaises(ValueError):
                score.read_completed(root / "out")

    def test_comparison_deltas_require_exact_reference_policy_and_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = write_fixture(root)
            before = score.evaluate(path, root / "before")
            after = score.evaluate(path, root / "after")
            delta = score.compare_reports(before, after)
            self.assertEqual(delta["cases"][0]["wholeSheetDelta"]["misses50"], 0)
            after["referenceSetSha256"] = "c"*64
            with self.assertRaisesRegex(ValueError, "referenceSetSha256"):
                score.compare_reports(before, after)


class FeedbackAdapter(unittest.TestCase):
    def floor(self, complete=False):
        shape = rectangle("a", .1, .1, .2, .2)["shape"]
        floor = {"floorId": "floor-a", "jobId": "site-a", "image": {"width": 1000, "height": 500},
            "sourceDrawing": {"sha256": SHA, "pageNumber": 18}, "approvedRooms": [{"id": "a", "shape": shape}],
            "completenessReviewed": complete, "floorStatus": "confirmed" if complete else "detected",
            "sourceReviewHash": SHA, "completenessReviewedAt": "2026-10-02T12:00:00Z",
            "floorConfirmedAt": "2026-10-02T12:00:01Z", "reviewCompletenessProvenance": "Fabricated app human attestation"}
        event = {"id": "a", "decision": "approved", "sourceReviewHash": SHA, "corrected": shape,
                 "proposal": shape, "reviewedAt": "2026-10-02T12:00:00Z"}
        return floor, event

    def test_partial_only_current_same_shape_and_source_positive_is_used(self):
        floor, event = self.floor()
        ref = prepare_feedback.reference_from_floor(floor, [event], confirmed_target="physical-spaces")
        self.assertEqual(ref["review"]["scope"], "reviewed-subset")
        self.assertEqual(ref["source"]["originalPageOneBased"], 18)
        changed = copy.deepcopy(event)
        changed["corrected"] = rectangle("a", .4, .4, .1, .1)["shape"]
        with self.assertRaisesRegex(ValueError, "No current"):
            prepare_feedback.reference_from_floor(floor, [changed], confirmed_target="physical-spaces")

    def test_complete_attestation_and_original_page_preserved_never_import_slot(self):
        floor, event = self.floor(True)
        floor["pageNumber"] = 19
        ref = prepare_feedback.reference_from_floor(floor, [event], confirmed_target="physical-spaces")
        self.assertEqual(ref["review"]["scope"], "complete-sheet")
        self.assertEqual(ref["source"]["originalPageOneBased"], 18)
        with self.assertRaises(ValueError):
            prepare_feedback.reference_from_floor(floor, [event], confirmed_target="units-and-common")

    def test_rejections_only_remain_zero_positive_partial(self):
        floor, event = self.floor()
        event["decision"] = "rejected"
        event["reviewReason"] = "boundary"
        ref = prepare_feedback.reference_from_floor(floor, [event], confirmed_target="physical-spaces")
        self.assertEqual(ref["rooms"], [])
        self.assertEqual(len(ref["rejected"]), 1)
        self.assertEqual(ref["rejected"][0]["reviewReason"], "boundary")

    def test_explicit_wrong_source_page_event_cannot_reenter_via_adapter(self):
        floor, event = self.floor()
        event["sourcePageNumber"] = 19
        with self.assertRaisesRegex(ValueError, "different original"):
            prepare_feedback.reference_from_floor(floor, [event], confirmed_target="physical-spaces")

    def export_fixture(self, root):
        floor, event = self.floor()
        job = next(f"test-job-{i}" for i in range(100) if prepare_feedback.job_split(f"test-job-{i}") == "development")
        pdf = root / "source.pdf"
        pdf.write_bytes(b"%PDF-1.7 fabricated feedback source; never decoded")
        digest = score.file_hash(pdf)
        floor.update(jobId=job, group=job, split="development", drawingKey="fabricated-image:19",
                     sourceReviewHash=digest)
        floor["sourceDrawing"].update(path="source.pdf", sha256=digest)
        event.update(floorId=floor["floorId"], group=job, split="development", drawingKey=floor["drawingKey"],
                     sourceReviewHash=digest, sourceVerified=True, detection={"drawingHash": digest})
        payload = {"version": 2, "target": "physical-spaces", "floors": [floor], "examples": [event]}
        path = root / "feedback.json"
        path.write_text(json.dumps(payload))
        return path, floor, event, payload

    def test_private_export_to_prepared_scorer_end_to_end(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path, floor, event, _ = self.export_fixture(root)
            reference = prepare_feedback.reference_from_floor(floor, [event], confirmed_target="physical-spaces")
            _, prediction = fixture()
            for key in ("sheetId", "source", "coordinateFrame", "targetPolicy", "rooms"):
                prediction[key] = copy.deepcopy(reference[key])
            predictions = root / "predictions"
            predictions.mkdir()
            (predictions / "floor-a.json").write_text(json.dumps(prediction))
            prepared = root / "prepared"
            manifest = prepare_feedback.prepare(path, predictions, prepared, confirmed_target="physical-spaces")
            self.assertEqual(len(manifest["cases"]), 1)
            result = score.evaluate(prepared / "manifest.json", root / "scored")
            self.assertEqual(result["cases"][0]["reviewedEvidence"]["recovered50"], 1)
            self.assertIsNone(result["summary"]["wholeSheetMetrics"])

    def test_whole_pdf_holdout_alias_is_quarantined_before_any_geometry_or_asset(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path, floor, _, payload = self.export_fixture(root)
            alias = copy.deepcopy(floor)
            job = next(f"held-job-{i}" for i in range(100) if prepare_feedback.job_split(f"held-job-{i}") == "holdout")
            alias.update(floorId="held-floor", jobId=job, group=job, split="holdout",
                         approvedRooms=[{"id": "invalid", "shape": {"not": "geometry"}}])
            payload["floors"].append(alias)
            path.write_text(json.dumps(payload))
            with patch.object(prepare_feedback, "private_file", side_effect=AssertionError("private assets accessed")):
                with self.assertRaisesRegex(ValueError, "No usable"):
                    prepare_feedback.prepare(path, root / "missing", root / "out", confirmed_target="physical-spaces")


class TrialWrapper(unittest.TestCase):
    def fixture(self, root, failed=False):
        path, floor, _, _ = FeedbackAdapter().export_fixture(root)
        trial = root / "trial"
        (trial / "sources").mkdir(parents=True)
        (trial / "physical").mkdir()
        shutil.copyfile(root / "source.pdf", trial / "source.pdf")
        source = trial / "sources/fabricated.py"
        source.write_text("# fabricated archive; never executed\n")
        archive = [{"path": "fabricated.py", "sha256": score.file_hash(source), "bytes": source.stat().st_size}]
        import hashlib
        digest = hashlib.sha256((json.dumps(archive, indent=2) + "\n").encode()).hexdigest()
        plan = {"version": "physical-eval-v1", "sourcePdfSha256": floor["sourceDrawing"]["sha256"],
                "pdfPageNumber": 18, "pdfPageIndex": 17, "sourceState": {"manifest": archive, "sourceManifestSha256": digest},
                "config": {"fabricated": True}}
        (trial / "plan.json").write_text(json.dumps(plan))
        outputs = []
        if not failed:
            result = trial / "physical/result.json"
            result.write_text(json.dumps({"rooms": [{"name": "Fabricated", "shape": rectangle("a", .1, .1, .2, .2)["shape"]}],
                                         "stats": {"config": {"fabricated": True}}}))
            outputs = [{"path": "physical/result.json", "sha256": score.file_hash(result), "bytes": result.stat().st_size}]
        completion = {"planSha256": score.file_hash(trial / "plan.json"), "sourceChangedDuringRun": False,
                      "finalSourceManifestSha256": digest, "status": "incomplete" if failed else "completed",
                      "outputs": outputs, "results": [{"mode": "physical", "status": "timeout" if failed else "completed",
                                                         "elapsedMs": 10, "sampledPeakRssBytes": 200}]}
        (trial / "completed.json").write_text(json.dumps(completion))
        return trial, path

    def test_saved_success_and_failure_convert_without_inference(self):
        for failed in (False, True):
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                trial, feedback = self.fixture(root, failed)
                result = wrap_trial.wrap(trial, feedback, "floor-a", "physical", "physical-spaces", root / "prediction.json")
                self.assertEqual(result["status"], "failed" if failed else "completed")
                self.assertEqual(len(result["rooms"]), 0 if failed else 1)
                self.assertEqual(result["source"]["originalPageOneBased"], 18)

    def test_known_producer_modes_cannot_be_relabeled_as_another_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for mode, policy in (("physical", "units-and-common"), ("tagged", "physical-spaces")):
                with self.assertRaisesRegex(ValueError, "cannot be relabeled"):
                    wrap_trial.wrap(root / "no-assets", root / "no-export", "floor-a", mode, policy, root / "prediction.json")

    def test_wrong_page_result_archive_or_source_change_is_rejected(self):
        for relative in ("source.pdf", "sources/fabricated.py", "physical/result.json", "plan.json"):
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                trial, feedback = self.fixture(root)
                with (trial / relative).open("ab") as handle:
                    handle.write(b" ")
                with self.assertRaises(ValueError):
                    wrap_trial.wrap(trial, feedback, "floor-a", "physical", "physical-spaces", root / "prediction.json")

    def test_trial_late_native_candidate_drift_never_emits_prediction(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            trial, feedback = self.fixture(root)
            original = wrap_trial.verify_pins
            def drift(pins):
                with (trial / "physical/result.json").open("ab") as handle:
                    handle.write(b" ")
                original(pins)
            with patch.object(wrap_trial, "verify_pins", side_effect=drift), self.assertRaises(ValueError):
                wrap_trial.wrap(trial, feedback, "floor-a", "physical", "physical-spaces", root / "prediction.json")
            self.assertFalse((root / "prediction.json").exists())


if __name__ == "__main__":
    unittest.main()
