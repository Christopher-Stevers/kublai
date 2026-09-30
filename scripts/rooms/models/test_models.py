"""Deterministic safety and topology checks for the offline challenger harness."""
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
from shapely.geometry import Point, Polygon, box
import torch

from build_data import build, draw_shapes, instance_masks, protected_sites, reviewed_targets, synthetic_floor, verified_review_floor
from common import HEADS, VERSION, checked_asset, file_hash, read_manifest
from network import StructuralUNet, supervised_loss
from predict import global_rooms, starts, stitched_probabilities
from evaluate_feedback import shape_polygon


def floor(complete=False):
    return {"approvedRooms": [{"id": "manual-missed-room", "shape": {"type": "bbox", "x": 0.2, "y": 0.2, "w": 0.2, "h": 0.2}}],
            "completenessReviewed": complete, "floorStatus": "confirmed" if complete else "detected",
            "reviewCompletenessProvenance": "User explicitly checked all rooms." if complete else "Not attested.",
            "sourceReviewHash": "a" * 64 if complete else None, "sourceDrawing": {"sha256": "a" * 64},
            "completenessReviewedAt": "2026-09-30T13:00:00Z" if complete else None,
            "floorConfirmedAt": "2026-09-30T13:00:01Z" if complete else None}


class SupervisionTests(unittest.TestCase):
    def test_partial_positives_require_immutable_matching_source_approval(self):
        value = floor()
        correct = {"id": "manual-missed-room", "decision": "approved", "sourceReviewHash": "a" * 64,
                   "corrected": value["approvedRooms"][0]["shape"]}
        for example in [{**correct, "decision": "rejected"}, {**correct, "sourceReviewHash": None},
                        {**correct, "sourceReviewHash": "b" * 64}]:
            self.assertEqual(verified_review_floor(value, [example], "a" * 64)["approvedRooms"], [])
        accepted = verified_review_floor(value, [correct], "a" * 64)
        self.assertEqual(len(accepted["approvedRooms"]), 1)
        self.assertFalse(accepted["completenessReviewed"])

    def test_current_source_attestation_cannot_survive_replaced_pdf(self):
        value = floor(True)
        value["sourceDrawing"] = {"sha256": "b" * 64}
        _, known = reviewed_targets(value, 100, 100)
        self.assertEqual(known[:, 70, 70].sum(), 0)
    def test_partial_manual_addition_is_positive_and_unknown_area_is_not_background(self):
        target, known = reviewed_targets(floor(), 100, 100)
        self.assertEqual(target[0, 30, 30], 1)
        self.assertEqual(known[0, 30, 30], 1)
        self.assertEqual(known[:, 70, 70].sum(), 0)
        self.assertEqual(known[2].sum(), 0)

    def test_partial_review_teaches_boundary_negatives_only_inside_approved_rooms(self):
        target, known = reviewed_targets(floor(), 100, 100)
        self.assertEqual(target[1, 30, 30], 0)
        self.assertEqual(known[1, 30, 30], 1)
        self.assertEqual(target[1, 20, 30], 1)
        self.assertEqual(known[1, 20, 30], 1)
        logits = torch.zeros((1, 3, 100, 100), requires_grad=True)
        loss = supervised_loss(logits, torch.tensor(target[None], dtype=torch.float32),
                               torch.tensor(known[None], dtype=torch.float32))
        loss.backward()
        # Gradient descent lowers false boundary scores in a verified interior,
        # raises the known boundary, and leaves every unchecked region unknown.
        self.assertGreater(float(logits.grad[0, 1, 30, 30]), 0)
        self.assertLess(float(logits.grad[0, 1, 20, 30]), 0)
        self.assertEqual(float(logits.grad[0, :, 70, 70].abs().sum()), 0)

    def test_legacy_confirmation_or_false_completeness_cannot_enable_dense_targets(self):
        value = floor()
        value["floorStatus"] = "confirmed"
        _, known = reviewed_targets(value, 100, 100)
        self.assertEqual(known[:, 70, 70].sum(), 0)
        value = floor(True)
        value["completenessReviewedAt"] = None
        _, known = reviewed_targets(value, 100, 100)
        self.assertEqual(known[:, 70, 70].sum(), 0)

    def test_explicit_complete_review_enables_background_but_not_unknown_door_labels(self):
        target, known = reviewed_targets(floor(True), 100, 100)
        self.assertEqual(target[0, 70, 70], 0)
        self.assertTrue(np.all(known[:2] == 1))
        self.assertEqual(known[2].sum(), 0)

    def test_unknown_or_rejected_region_has_zero_training_gradient(self):
        target, known = reviewed_targets(floor(), 100, 100)
        logits = torch.zeros((1, 3, 100, 100), requires_grad=True)
        expected, mask = torch.tensor(target[None], dtype=torch.float32), torch.tensor(known[None], dtype=torch.float32)
        loss = supervised_loss(logits, expected, mask)
        changed = logits.detach().clone()
        changed[:, :, 70:80, 70:80] = 100
        self.assertEqual(float(loss.detach()), float(supervised_loss(changed, expected, mask)))
        loss.backward()
        self.assertEqual(float(logits.grad[:, :, 70:80, 70:80].abs().sum()), 0)
        self.assertEqual(float(logits.grad[:, 2].abs().sum()), 0)

    def test_enclosing_corridor_hole_does_not_erase_an_inner_room(self):
        corridor = Polygon([(5, 5), (95, 5), (95, 95), (5, 95)], [[(25, 25), (75, 25), (75, 75), (25, 75)]])
        interior, _ = draw_shapes([box(30, 30, 70, 70), corridor], 100, 100, lambda x, y: (x, y))
        truth = instance_masks([box(30, 30, 70, 70), corridor], 100, 100, lambda x, y: (x, y))
        self.assertTrue(interior[50, 50])
        self.assertEqual(truth[50, 50], 1)
        self.assertEqual(truth[10, 50], 2)
        self.assertEqual(truth[27, 50], 0)

    def test_synthetic_renders_are_reproducible_and_seeds_change_nuisances(self):
        rooms = [{"entity_type": "area", "entity_subtype": "ROOM", "geom": box(x, 0, x + 4, 6).wkt} for x in (0, 4, 8)]
        first = synthetic_floor({"rooms": rooms}, 123)
        second = synthetic_floor({"rooms": rooms}, 123)
        different = synthetic_floor({"rooms": rooms}, 456)
        self.assertTrue(np.array_equal(np.asarray(first[0]), np.asarray(second[0])))
        self.assertTrue(np.array_equal(first[1], second[1]))
        self.assertFalse(np.array_equal(np.asarray(first[0]), np.asarray(different[0])))
        self.assertEqual(len(np.unique(first[3])) - 1, 3)


class IntegrityTests(unittest.TestCase):
    def test_legacy_feedback_builder_is_disabled_before_any_asset_access(self):
        args = SimpleNamespace(feedback=[Path("/unresolved-private-review/feedback.json")])
        with patch("build_data.source_hashes") as sources, patch("build_data.file_hash") as hashes:
            with self.assertRaisesRegex(ValueError, "use context_review_data.py"):
                build(args)
            sources.assert_not_called()
            hashes.assert_not_called()

    def test_entire_protected_sites_are_excluded_for_both_existing_splits(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "protected.json"
            path.write_text(json.dumps([{"site": "a", "split": "development"}, {"site": "b", "split": "holdout"}, {"site": "a", "id": "another-floor"}]))
            self.assertEqual(protected_sites(path), {"a", "b"})

    def test_training_manifest_rejects_site_leakage_and_protected_holdout(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image, targets = root / "image.png", root / "targets.npz"
            Image.new("RGB", (20, 20)).save(image)
            np.savez(targets, target=np.zeros((3, 20, 20)), known=np.zeros((3, 20, 20)))
            record = {"source": "synthetic-msd", "site": "protected", "group": "site:protected", "split": "train",
                      "image": image.name, "targets": targets.name, "image_sha256": file_hash(image), "targets_sha256": file_hash(targets)}
            manifest = {"version": VERSION, "heads": list(HEADS), "excluded_msd_sites": ["protected"], "records": [record]}
            path = root / "manifest.json"
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "Protected MSD"):
                read_manifest(path)
            record["site"], record["split"] = "new", "holdout"
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "holdout"):
                read_manifest(path)
            record["split"] = "train"
            manifest["records"].append({**record, "split": "validation"})
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "both"):
                read_manifest(path)

    def test_assets_require_current_hash_and_cannot_escape_export(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            asset = root / "input"
            asset.write_text("one")
            digest = file_hash(asset)
            asset.write_text("two")
            with self.assertRaisesRegex(ValueError, "hash changed"):
                checked_asset(root, "input", digest)
            outside = root.parent / "outside-room-harness-fixture"
            outside.write_text("fixture")
            try:
                with self.assertRaisesRegex(ValueError, "escapes"):
                    checked_asset(root, "../outside-room-harness-fixture", file_hash(outside))
            finally:
                outside.unlink()


class GeometryTests(unittest.TestCase):
    def test_one_pixel_bridge_exports_one_valid_connected_room_without_losing_labels(self):
        mask = np.zeros((80, 100), dtype=bool)
        mask[10:35, 10:35] = True
        mask[10:35, 65:90] = True
        mask[22, 35:65] = True
        probability = np.ones((3, *mask.shape), dtype=np.float32)
        probability[1] = ~mask
        probability[2] = 0
        labels, rooms = global_rooms(probability)
        self.assertEqual(len(rooms), 1)
        self.assertTrue(np.array_equal(labels > 0, mask))
        self.assertEqual(set(np.unique(labels)) - {0}, {rooms[0]["label"]})
        polygon = shape_polygon(rooms[0]["shape"])
        self.assertTrue(polygon.contains(Point(49.25 / 100, 22.25 / 80)))
        self.assertTrue(polygon.contains(Point(20 / 100, 20 / 80)))
        self.assertTrue(polygon.contains(Point(75 / 100, 20 / 80)))

    def test_one_pixel_corridor_exports_its_hole_and_keeps_the_component(self):
        mask = np.zeros((50, 60), dtype=bool)
        mask[10:40, 10:50] = True
        mask[11:39, 11:49] = False
        probability = np.ones((3, *mask.shape), dtype=np.float32)
        probability[1] = ~mask
        probability[2] = 0
        labels, rooms = global_rooms(probability)
        self.assertEqual(len(rooms), 1)
        self.assertTrue(np.array_equal(labels > 0, mask))
        polygon = shape_polygon(rooms[0]["shape"])
        self.assertEqual(len(polygon.interiors), 1)
        self.assertFalse(polygon.covers(Point(30 / 60, 25 / 50)))

    def test_diagonal_shell_hole_contact_uses_valid_cell_geometry(self):
        # Native and doubled OpenCV contours make this shell touch its hole
        # along an edge. The actual pixel-cell union has a valid retained hole.
        component = np.asarray([
            [0, 1, 1, 1, 0, 0], [0, 1, 1, 1, 0, 0], [0, 1, 1, 1, 0, 0],
            [1, 1, 1, 0, 1, 0], [1, 0, 1, 1, 1, 0], [0, 0, 0, 0, 1, 1],
            [0, 0, 0, 0, 0, 1], [0, 0, 0, 0, 1, 1], [0, 0, 0, 1, 1, 1],
        ], dtype=bool)
        mask = np.pad(component, 2)
        probability = np.ones((3, *mask.shape), dtype=np.float32)
        probability[1] = ~mask
        probability[2] = 0
        labels, rooms = global_rooms(probability, min_area=1)
        self.assertEqual(len(rooms), 1)
        self.assertTrue(np.array_equal(labels > 0, mask))
        polygon = shape_polygon(rooms[0]["shape"])
        self.assertEqual(len(polygon.interiors), 1)

    def test_global_polygonizer_finds_unlabeled_corridor_and_preserves_its_hole(self):
        probability = np.zeros((3, 100, 120), dtype=np.float32)
        probability[0] = 1
        for left, right, top, bottom in [(10, 110, 10, 90), (40, 80, 35, 65)]:
            probability[1, top:bottom + 1, [left, right]] = 1
            probability[1, [top, bottom], left:right + 1] = 1
        labels, rooms = global_rooms(probability)
        self.assertEqual(len(rooms), 2)
        corridor = next(room for room in rooms if room["shape"].get("holes"))
        self.assertEqual(len(corridor["shape"]["holes"]), 1)
        self.assertNotEqual(labels[20, 50], labels[50, 50])
        self.assertEqual(labels[0, 0], 0)
        self.assertTrue(all(room["detection"]["requiresReview"] for room in rooms))

    def test_stitching_has_no_uncovered_pixels_or_seam_duplicates(self):
        class Constant(torch.nn.Module):
            def forward(self, value):
                return torch.zeros((value.shape[0], 3, *value.shape[-2:]))
        image = np.ones((73, 151, 3), dtype=np.float32)
        result = stitched_probabilities(Constant(), image, 64, 24, torch.device("cpu"))
        self.assertTrue(np.allclose(result, 0.5))
        self.assertTrue(np.isfinite(result).all())
        self.assertEqual(starts(151, 64, 24)[-1], 151 - 64)
        with self.assertRaises(ValueError):
            starts(100, 64, 64)

    def test_compact_network_preserves_dimensions_and_can_learn_with_sparse_targets(self):
        torch.set_num_threads(2)
        model = StructuralUNet(base=8)
        logits = model(torch.rand(2, 3, 64, 80))
        self.assertEqual(tuple(logits.shape), (2, 3, 64, 80))
        target, known = torch.zeros_like(logits), torch.zeros_like(logits)
        target[:, 0, 10:30, 10:30] = 1
        known[:, 0, 10:30, 10:30] = 1
        loss = supervised_loss(logits, target, known)
        self.assertTrue(bool(torch.isfinite(loss)))
        loss.backward()
        self.assertTrue(any(p.grad is not None and bool(p.grad.abs().sum() > 0) for p in model.parameters()))


if __name__ == "__main__":
    unittest.main()
