import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from common import (checked_records, correction_tap, interior_tap,
                    mask_iou, mask_polygons, select_mask, validate_points)
from common import rasterize_polygons


class PromptProtocolTests(unittest.TestCase):
    def test_finite_bounded_positive_taps_required(self):
        for taps in ([[1, 2, 0]], [[1, 2, 2]], [[float("nan"), 2, 1]],
                     [[10, 2, 1]], [[-1, 2, 1]], [], [[1, 2]]):
            with self.assertRaises(ValueError):
                validate_points(taps, 10, 10)
        points, labels = validate_points([[2, 3, 1], [8, 9, 0]], 10, 10)
        self.assertEqual(points.tolist(), [[2, 3], [8, 9]])
        self.assertEqual(labels.tolist(), [1, 0])

    def test_prompt_compliance_precedes_predicted_score(self):
        masks = np.zeros((3, 20, 20), bool)
        masks[0] = True; masks[1, 3:7, 3:7] = True; masks[2] = masks[1]
        points, labels = validate_points([[5, 5, 1], [15, 15, 0]], 20, 20)
        self.assertEqual(select_mask(masks, np.array([.99, .5, .6]), points, labels), 2)

    def test_correction_taps_largest_connected_error(self):
        truth = np.zeros((30, 30), bool); truth[2:15, 2:15] = True
        predicted = np.zeros_like(truth); predicted[20:24, 20:24] = True
        x, y, value = correction_tap(truth, predicted)
        self.assertEqual(value, 1); self.assertTrue(truth[y, x]); self.assertFalse(predicted[y, x])
        self.assertIsNone(correction_tap(truth, truth))

    def test_negative_correction_for_merged_neighbor(self):
        truth = np.zeros((30, 30), bool); truth[2:7, 2:7] = True
        predicted = truth.copy(); predicted[10:25, 10:25] = True
        x, y, value = correction_tap(truth, predicted)
        self.assertEqual(value, 0); self.assertFalse(truth[y, x]); self.assertTrue(predicted[y, x])

    def test_tap_inside_l_shaped_hallway(self):
        truth = np.zeros((30, 30), bool); truth[2:25, 2:8] = True; truth[2:8, 2:25] = True
        x, y = interior_tap(truth); self.assertTrue(truth[y, x])

    def test_polygon_export_preserves_hole_and_islands(self):
        mask = np.zeros((100, 100), bool); mask[10:80, 10:80] = True
        mask[30:60, 30:60] = False; mask[85:95, 85:95] = True
        polygons = mask_polygons(mask)
        self.assertEqual(len(polygons), 2); self.assertEqual(len(polygons[0]["holes"]), 1)
        self.assertAlmostEqual(polygons[0]["area_fraction"], .4)
        emitted = rasterize_polygons(polygons, mask.shape)
        self.assertFalse(emitted[45, 45]); self.assertTrue(emitted[90, 90])
        self.assertTrue(np.array_equal(mask, emitted))

    def test_diagonal_pixel_contacts_round_trip_to_valid_shapes(self):
        mask = np.zeros((20, 20), bool)
        mask[3:8, 3:8] = True; mask[8:13, 8:13] = True
        mask[6:10, 12:17] = True; mask[7:9, 13:16] = False
        polygons = mask_polygons(mask)
        self.assertTrue(np.array_equal(mask, rasterize_polygons(polygons, mask.shape)))
        self.assertAlmostEqual(sum(p["area_fraction"] for p in polygons), mask.mean())

    def test_empty_and_exact_iou(self):
        empty = np.zeros((5, 5), bool)
        self.assertEqual(mask_iou(empty, empty), 1)
        self.assertEqual(mask_polygons(empty), [])
        with self.assertRaises(ValueError):
            interior_tap(empty)

    def test_protected_split_or_site_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            manifest = {"experiment": "whole-sheet-context-v2", "excluded_msd_sites": ["1"],
                        "records": [{"split": "holdout", "site": "2"}]}
            path.write_text(json.dumps(manifest))
            with self.assertRaises(ValueError):
                checked_records(path, 1)
            manifest["records"] = [{"split": "validation", "site": "1"}]
            path.write_text(json.dumps(manifest))
            with self.assertRaises(ValueError):
                checked_records(path, 1)
            manifest["records"] = [{"split": "validation", "site": "2", "id": "dev"}]
            path.write_text(json.dumps(manifest))
            self.assertEqual(checked_records(path, 1)[1][0]["id"], "dev")


if __name__ == "__main__":
    unittest.main()
