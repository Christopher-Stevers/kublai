import unittest

import numpy as np

from partition_saved import partition


class PartitionTests(unittest.TestCase):
    def fixture(self):
        rooms = np.zeros((60, 80), dtype=np.uint8)
        rooms[5:55, 5] = rooms[5:55, 74] = 2
        rooms[5, 5:75] = rooms[54, 5:75] = 2
        return rooms, np.zeros_like(rooms)

    def test_door_separates_two_instances_and_outer_background_is_unresolved(self):
        rooms, icons = self.fixture()
        rooms[5:55, 40] = 2
        rooms[24:31, 40] = 0
        icons[24:31, 40] = 2
        records, _, _ = partition(rooms, icons)
        self.assertEqual(sum(r['status'] == 'unreviewed-proposal' for r in records), 2)
        self.assertEqual(sum(r['status'] == 'unresolved-crop-edge' for r in records), 1)

    def test_unobserved_doorway_does_not_get_arbitrarily_closed(self):
        rooms, icons = self.fixture()
        rooms[5:55, 40] = 2
        rooms[24:31, 40] = 0
        records, _, _ = partition(rooms, icons)
        self.assertEqual(sum(r['status'] == 'unreviewed-proposal' for r in records), 1)

    def test_column_preserves_hole_and_closing_records_invented_pixels(self):
        rooms, icons = self.fixture()
        rooms[25:30, 25:30] = 2
        rooms[5, 20] = 0
        records, _, stats = partition(rooms, icons)
        inside = [r for r in records if r['status'] == 'unreviewed-proposal']
        self.assertEqual(len(inside), 1)
        self.assertEqual(len(inside[0]['holes']), 1)
        self.assertGreater(stats['added_barrier_pixels'], 0)
        self.assertEqual(stats['removed_barrier_pixels'], 0)

    def test_source_edge_is_not_artificially_walled_off(self):
        rooms = np.zeros((40, 40), dtype=np.uint8)
        records, barrier, _ = partition(rooms, rooms.copy())
        self.assertFalse(barrier.any())
        self.assertEqual([r['status'] for r in records], ['unresolved-crop-edge'])

    def test_invalid_head_values_or_shapes_fail(self):
        rooms, icons = self.fixture()
        for invalid in (rooms.astype(float), np.zeros((0, 0), np.uint8), rooms[:, :30], rooms + 20):
            with self.assertRaises(ValueError):
                partition(invalid, icons)


if __name__ == '__main__':
    unittest.main()
