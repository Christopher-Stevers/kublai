import unittest

from shapely.geometry import Polygon, box

from review_annotation import significant_room_overlaps


class DenseAnnotationTests(unittest.TestCase):
    def test_nested_and_duplicate_physical_rooms_are_quarantined(self):
        room = box(0.1, 0.1, 0.4, 0.4)
        self.assertEqual(len(significant_room_overlaps([("unit", room), ("room", box(0.15, 0.15, 0.2, 0.2))], 1000, 1000)), 1)
        self.assertEqual(len(significant_room_overlaps([("a", room), ("b", room)], 1000, 1000)), 1)

    def test_boundary_pixel_tolerance_does_not_hide_large_overlap(self):
        left = box(0.1, 0.1, 0.4, 0.4)
        self.assertEqual(significant_room_overlaps([("a", left), ("b", box(0.399, 0.1, 0.7, 0.4))], 1000, 1000), [])
        self.assertEqual(len(significant_room_overlaps([("a", left), ("b", box(0.38, 0.1, 0.7, 0.4))], 1000, 1000)), 1)

    def test_corridor_hole_and_adjacent_room_are_legitimate(self):
        corridor = Polygon([(0.1, 0.1), (0.8, 0.1), (0.8, 0.8), (0.1, 0.8)],
                           [[(0.3, 0.3), (0.5, 0.3), (0.5, 0.5), (0.3, 0.5)]])
        self.assertEqual(significant_room_overlaps([("hall", corridor), ("room", box(0.3, 0.3, 0.5, 0.5))], 1000, 1000), [])

    def test_tiny_duplicate_still_rejected_after_erosion(self):
        tiny = box(0.1, 0.1, 0.101, 0.101)
        self.assertEqual(len(significant_room_overlaps([("a", tiny), ("b", tiny)], 1000, 1000)), 1)


if __name__ == "__main__":
    unittest.main()
