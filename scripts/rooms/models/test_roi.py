import unittest

import numpy as np

from roi_challenger import bounded_rooms
from roi_evaluate import missing_reasons


class BoundedROITests(unittest.TestCase):
    def test_exterior_leak_recovers_one_room_without_added_partition(self):
        probability = np.zeros((3, 80, 80), dtype=np.float32)
        probability[0, 15:65, 15:65] = 0.95
        probability[1, 14:66, 14] = probability[1, 14:66, 65] = 1
        probability[1, 14, 14:66] = probability[1, 65, 14:66] = 1
        probability[1, 14, 35:45] = 0
        self.assertEqual(len(bounded_rooms(probability, "baseline")[1]), 0)
        labels, rooms, _ = bounded_rooms(probability, "bounded_roi")
        self.assertEqual(len(rooms), 1)
        self.assertGreater(np.count_nonzero(labels[15:65, 15:65]), 2400)

    def test_existing_internal_boundary_still_separates(self):
        probability = np.zeros((3, 80, 80), dtype=np.float32)
        probability[0, 15:65, 15:65] = 0.95
        probability[1, 40, 14:66] = 1
        labels, rooms, _ = bounded_rooms(probability, "bounded_roi")
        self.assertEqual(len(rooms), 2)
        self.assertNotEqual(labels[25, 25], labels[55, 25])

    def test_low_occupancy_hole_does_not_invent_internal_boundary(self):
        probability = np.zeros((3, 80, 80), dtype=np.float32)
        probability[0, 15:65, 15:65] = 0.95
        probability[0, 25:55, 25:55] = 0
        labels, rooms, _ = bounded_rooms(probability, "bounded_roi")
        self.assertEqual(len(rooms), 1)
        self.assertGreater(labels[40, 40], 0)

    def test_real_barrier_hole_survives(self):
        probability = np.zeros((3, 80, 80), dtype=np.float32)
        probability[0, 15:65, 15:65] = 0.95
        probability[0, 30:50, 30:50] = 0
        probability[1, 29:51, 29] = probability[1, 29:51, 50] = 1
        probability[1, 29, 29:51] = probability[1, 50, 29:51] = 1
        _, rooms, _ = bounded_rooms(probability, "bounded_roi")
        self.assertEqual(len(rooms), 1)
        self.assertTrue(rooms[0]["shape"].get("holes"))

    def test_scale_area_keeps_narrow_hall_but_removes_tiny_symbol(self):
        probability = np.zeros((3, 64, 2048), dtype=np.float32)
        probability[0, 15:18, 20:220] = 0.95
        probability[0, 35:40, 20:25] = 0.95
        # Native closed barriers avoid a comparison dominated by border leaks.
        probability[1, 14:19, 19] = probability[1, 14:19, 220] = 1
        probability[1, 14, 19:221] = probability[1, 18, 19:221] = 1
        probability[1, 34:41, 19] = probability[1, 34:41, 25] = 1
        probability[1, 34, 19:26] = probability[1, 40, 19:26] = 1
        self.assertEqual(len(bounded_rooms(probability, "baseline")[1]), 2)
        labels, rooms, diagnostics = bounded_rooms(probability, "bounded_scaled_core")
        self.assertEqual(diagnostics["minimum_area_pixels"], 100)
        self.assertEqual(len(rooms), 1)
        self.assertGreater(labels[16, 100], 0)
        self.assertEqual(labels[37, 22], 0)

    def test_rejects_unknown_or_invalid_input(self):
        probability = np.zeros((3, 10, 10), dtype=np.float32)
        with self.assertRaises(ValueError):
            bounded_rooms(probability, "ad-hoc")
        probability[0, 0, 0] = np.nan
        with self.assertRaises(ValueError):
            bounded_rooms(probability, "bounded_roi")

    def test_missing_diagnostics_distinguish_border_leak_and_retained_merge(self):
        probability = np.zeros((3, 80, 80), dtype=np.float32)
        truth = np.zeros((80, 80), dtype=np.int32)
        truth[15:45, 15:25], truth[15:45, 25:35], truth[15:45, 35:45] = 1, 2, 3
        probability[0, truth > 0] = 0.95
        prediction = np.zeros_like(truth)
        leak = missing_reasons(truth, prediction, probability)
        self.assertEqual(leak["counts"]["raw_border_rejection"], 3)
        prediction[truth > 0] = 1
        merged = missing_reasons(truth, prediction, probability)
        self.assertEqual(merged["counts"]["retained_merge_associated"], 3)
        self.assertEqual(sum(merged["counts"].values()), 3)


if __name__ == "__main__":
    unittest.main()
