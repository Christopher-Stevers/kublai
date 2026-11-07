"""Independent floor/duplicate drawings. No downloaded corpus targets are read."""
import unittest
import numpy as np
from scipy import ndimage

import passages
import repeat


def repeated_fixture():
    shape = np.zeros((56, 70), bool)
    shape[5:51, 5:65] = True
    shape[5:18, 5:20] = False  # asymmetric physical corner
    shape[30:35, 38:44] = False  # column hole
    pattern = ndimage.binary_dilation(shape, iterations=2) & ~shape
    pattern[22:28, 7:11] = True  # asymmetric fixture
    ink = np.zeros((240, 360), bool)
    masks = []
    for y, x, k, m in [(15, 15, 0, False), (15, 115, 0, True), (15, 220, 1, False), (130, 30, 0, False)]:
        wall, room = repeat.transform(pattern, k, m), repeat.transform(shape, k, m)
        ink[y:y+wall.shape[0], x:x+wall.shape[1]] = wall
        mask = np.zeros_like(ink)
        mask[y:y+room.shape[0], x:x+room.shape[1]] = room
        masks.append(mask)
    # The last lookalike contains a NEW dividing wall. It must not copy the room.
    ink[130+22:130+51, 30+30:30+32] = True
    return ink, masks


def corridor_fixture():
    wall = np.zeros((180, 280), bool)
    wall[10:14, 10:270] = True
    wall[166:170, 10:270] = True
    wall[10:170, 10:14] = True
    wall[10:170, 266:270] = True
    wall[10:170, 114:118] = True
    wall[10:170, 162:166] = True
    wall[88:92, 10:118] = True
    wall[88:92, 162:270] = True
    for y in (47, 126):
        wall[y:y+8, 114:118] = False
        wall[y:y+8, 162:166] = False
    return wall


class RepetitionTests(unittest.TestCase):
    def test_mirror_rotation_holes_and_changed_wall(self):
        ink, masks = repeated_fixture()
        results, diag = repeat.proposals(ink, masks[0], 'human-reviewed')
        self.assertEqual(len(results), 2, diag)
        output = []
        for r in results:
            mask = np.zeros_like(ink)
            y, x = r['y'], r['x']
            mask[y:y+r['mask'].shape[0], x:x+r['mask'].shape[1]] = r['mask']
            output.append(mask)
            self.assertTrue(r['requires_review'])
            self.assertEqual(r['review_status'], 'pending')
            self.assertFalse(r['score_is_calibrated_confidence'])
        for expected in masks[1:3]:
            self.assertGreater(max((m & expected).sum()/(m | expected).sum() for m in output), .98)
        self.assertGreater(diag['rejected']['new_partition']+diag['rejected']['precision'], 0)

    def test_development_seed_never_becomes_human_approval(self):
        ink, masks = repeated_fixture()
        results, _ = repeat.proposals(ink, masks[0], 'development-hypothesis')
        self.assertTrue(all(r['example_kind'] == 'development-hypothesis' and r['review_status'] == 'pending' for r in results))

    def test_empty_or_multiple_examples_rejected(self):
        ink, masks = repeated_fixture()
        for example in (np.zeros_like(ink), masks[0] | masks[1]):
            with self.assertRaises(ValueError):
                repeat.proposals(ink, example, 'human-reviewed')

    def test_blank_boundary_is_not_an_example(self):
        ink, masks = repeated_fixture()
        with self.assertRaisesRegex(ValueError, 'evidence'):
            repeat.proposals(np.zeros_like(ink), masks[0], 'human-reviewed')

    def test_unknown_source_kind_rejected(self):
        ink, masks = repeated_fixture()
        with self.assertRaises(ValueError):
            repeat.proposals(ink, masks[0], 'approved-by-model')

    def test_too_repetitive_fails_instead_of_truncating(self):
        ink = np.zeros((320, 320), bool)
        for y in range(5, 300, 25):
            for x in range(5, 300, 25):
                ink[y:y+20, x] = ink[y:y+20, x+19] = True
                ink[y, x:x+20] = ink[y+19, x:x+20] = True
        example = np.zeros_like(ink)
        example[31:49, 31:49] = True
        with self.assertRaisesRegex(RuntimeError, 'candidate budget'):
            repeat.proposals(ink, example, 'human-reviewed')


class PassageTests(unittest.TestCase):
    def test_four_unlabeled_rooms_and_common_hall(self):
        labels, cuts, diag = passages.partition(corridor_fixture())
        self.assertEqual(len(cuts), 4, diag)
        self.assertEqual(labels.max(), 5, diag)
        # All four rooms differ, and the long common corridor remains ONE room.
        ids = [labels[y, x] for y, x in [(40, 60), (130, 60), (40, 210), (130, 210), (25, 140)]]
        self.assertEqual(len(set(ids)), 5)
        self.assertNotIn(0, ids)
        self.assertEqual(labels[25, 140], labels[150, 140])

    def test_quarter_turn_equivalent_rooms(self):
        labels, cuts, diag = passages.partition(np.rot90(corridor_fixture()).copy())
        self.assertEqual(len(cuts), 4, diag)
        self.assertEqual(labels.max(), 5, diag)

    def test_bent_uniform_hall_not_split(self):
        floor = np.zeros((180, 180), bool)
        floor[20:155, 20:40] = True
        floor[135:155, 20:155] = True
        wall = ndimage.binary_dilation(floor, iterations=3) & ~floor
        labels, cuts, diag = passages.partition(wall)
        self.assertEqual(cuts, [], diag)
        self.assertEqual(labels.max(), 1, diag)

    def test_isolated_furniture_cannot_witness_a_wall_gap(self):
        floor = np.zeros((140, 160), bool)
        floor[15:125, 15:145] = True
        wall = ndimage.binary_dilation(floor, iterations=3) & ~floor
        wall[50:65, 65:85] = True
        wall[75:90, 65:85] = True
        labels, cuts, diag = passages.partition(wall)
        self.assertEqual(cuts, [], diag)
        self.assertEqual(labels.max(), 1, diag)

    def test_exterior_leak_remains_explicitly_unresolved(self):
        walls = corridor_fixture()
        walls[10:14, 118:162] = False  # wide leak, not a supported narrow portal
        labels, _, diag = passages.partition(walls)
        self.assertEqual(labels[25, 140], 0)
        self.assertGreater(diag['unresolved_exterior_pixels'], 1000)
        self.assertFalse(diag['approved_for_production'])

    def test_invalid_input(self):
        for bad in (np.zeros((30, 30)), np.zeros((2, 3), bool), np.zeros((2, 20, 20), bool)):
            with self.assertRaises(ValueError):
                passages.partition(bad)


if __name__ == '__main__':
    unittest.main()
