"""Fabricated marker and exact-topology tests; no corpus/model input."""
import unittest

import numpy as np
from shapely.geometry import Point, Polygon

from partition import PRESETS, exact_cell_polygon, export_rooms, merge_weak_interfaces, partition_rooms


class PartitionTests(unittest.TestCase):
    def test_inferred_markers_recover_two_spaces_despite_outer_leak(self):
        p = np.zeros((3, 100, 160), dtype=np.float32)
        p[0, 10:90, 10:150] = 1
        p[1, 10:90, 80] = 0.7
        p[1, 45:55, 80] = 0.3
        labels, rooms, diagnostic = partition_rooms(p, "weighted_basins")
        self.assertGreaterEqual(diagnostic["markers"], 2)
        self.assertNotEqual(labels[40, 40], labels[40, 120])
        self.assertGreater(labels[40, 40], 0)
        self.assertEqual(labels[0, 0], 0)
        self.assertEqual(set(np.unique(labels)) - {0}, {room["label"] for room in rooms})

    def test_weak_interface_merges_but_strong_wall_does_not(self):
        labels = np.ones((30, 60), dtype=np.int32)
        labels[:, 30:] = 2
        barrier = np.zeros(labels.shape, dtype=np.float32)
        merged, count = merge_weak_interfaces(labels, barrier, 0.2)
        self.assertEqual(count, 1)
        self.assertEqual(len(np.unique(merged)), 1)
        barrier[:, 29:31] = 0.7
        retained, count = merge_weak_interfaces(labels, barrier, 0.2)
        self.assertEqual(count, 0)
        self.assertTrue(np.array_equal(labels, retained))

    def test_exact_polygon_keeps_one_pixel_bridge_and_corridor_hole(self):
        mask = np.zeros((60, 120), dtype=bool)
        mask[10:50, 10:110] = 1
        mask[11:49, 11:109] = 0
        polygon = exact_cell_polygon(mask)
        self.assertEqual(len(polygon.interiors), 1)
        self.assertEqual(polygon.area, mask.sum())
        self.assertTrue(polygon.contains(Point(10.5, 30.5)))
        self.assertFalse(polygon.covers(Point(60.5, 30.5)))
        bridge = np.zeros((50, 100), dtype=bool)
        bridge[10:30, 10:30] = bridge[10:30, 70:90] = 1
        bridge[20, 30:70] = 1
        polygon = exact_cell_polygon(bridge)
        self.assertTrue(polygon.is_valid)
        self.assertEqual(polygon.area, bridge.sum())

    def test_normalized_polygon_area_exactly_matches_pixels_and_ids(self):
        labels = np.zeros((50, 100), dtype=np.int32)
        labels[4:40, 10:90] = 1
        labels[15:25, 30:40] = 0
        p = np.ones((3, *labels.shape), dtype=np.float32)
        room = export_rooms(labels, p)[0]
        shape = room["shape"]
        poly = Polygon([(point["x"], point["y"]) for point in shape["points"]],
                       [[(point["x"], point["y"]) for point in hole] for hole in shape["holes"]])
        self.assertTrue(poly.is_valid)
        self.assertAlmostEqual(poly.area * labels.size, (labels > 0).sum())
        self.assertTrue(room["detection"]["requiresReview"])

    def test_no_confident_input_has_no_guessed_room_marker(self):
        labels, rooms, detail = partition_rooms(np.zeros((3, 50, 60)), "hierarchical_basins")
        self.assertEqual(detail["markers"], 0)
        self.assertEqual(rooms, [])
        self.assertFalse(labels.any())

    def test_exactly_three_settings_and_invalid_probabilities_rejected(self):
        self.assertEqual(len(PRESETS), 3)
        for p in [np.zeros((2, 50, 60)), np.full((3, 50, 60), np.nan), np.ones((3, 50, 60)) * 1.1]:
            with self.assertRaises(ValueError):
                partition_rooms(p, "weighted_basins")
        with self.assertRaises(ValueError):
            partition_rooms(np.zeros((3, 50, 60)), "unscored")


if __name__ == "__main__":
    unittest.main()
