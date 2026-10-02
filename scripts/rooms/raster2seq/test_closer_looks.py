import unittest
from closer_looks import classify, deduplicate, parent_relations, starts, tiles


def record(name, x0, x1, tile=None, label=1, edge=False):
    return {"id": name, "tile_id": tile or name, "label_id": label, "kind": "polygon", "valid_polygon": True, "outside_crop": False, "possible_crop_truncation": edge, "boundary_margin_native_px": 10, "full_page_normalized_points": [[x0, 0], [x1, 0], [x1, 1], [x0, 1]]}


class CloserLookTests(unittest.TestCase):
    def test_fixed_eighteen_windows_cover_the_four_parent_boxes(self):
        self.assertEqual(starts(1050), [0, 410])
        self.assertEqual(starts(1600), [0, 480, 960])
        self.assertEqual(starts(900), [0, 260])
        self.assertEqual(len(tiles()), 18)
        self.assertEqual(len(set(t["id"] for t in tiles())), 18)
        for t in tiles():
            self.assertEqual(t["box"][2] - t["box"][0], 640)
            self.assertEqual(t["box"][3] - t["box"][1], 640)
        with self.assertRaises(ValueError):
            starts(500)
        with self.assertRaises(ValueError):
            tiles((1000, 1000))

    def test_invalid_ring_is_quarantined_without_repair(self):
        row = classify([[.01, .01], [.02, .02], [.01, .02], [.02, .01]], [0, 0, 640, 640])
        self.assertFalse(row["valid_polygon"])
        self.assertEqual(row["export_status"], "quarantined-invalid")
        self.assertIn("intersection", row["invalid_reason"].lower())

    def test_crop_contact_and_outside_are_separate_warnings(self):
        pts = [[0, .01], [.01, .01], [.01, .02], [0, .02]]
        row = classify(pts, [0, 0, 640, 640])
        self.assertTrue(row["possible_crop_truncation"])
        self.assertFalse(row["outside_crop"])
        outside = classify([[-.001, .01], [.01, .01], [.01, .02], [-.001, .02]], [0, 0, 640, 640])
        self.assertTrue(outside["outside_crop"])

    def test_dedup_retains_exact_representative_and_class_conflicts(self):
        a, b = record("a", 0, 1), record("b", .01, 1.01, label=2)
        before = a["full_page_normalized_points"].copy()
        grouped = deduplicate([b, a])
        self.assertEqual([r["id"] for r in grouped["representatives"]], ["a"])
        self.assertEqual(grouped["representatives"][0]["full_page_normalized_points"], before)
        self.assertTrue(grouped["duplicate_groups"]["a"][0]["class_disagreement"])

    def test_dedup_does_not_chain_merge_or_remove_crop_edges(self):
        # a↔b and b↔c pass .85, but a↔c does not. Compare only the exact kept ring.
        a, b, c = record("a", 0, 1), record("b", .06, 1.06), record("c", .12, 1.12)
        grouped = deduplicate([c, a, b])
        self.assertEqual([r["id"] for r in grouped["representatives"]], ["a", "c"])
        edge = record("edge", 0, 1, edge=True)
        self.assertEqual(len(deduplicate([a, edge])["representatives"]), 2)

    def test_dedup_never_unions_nested_unit_and_room_hypotheses(self):
        unit, room = record("unit", 0, 1), record("room", .1, .3)
        grouped = deduplicate([unit, room])
        self.assertEqual(len(grouped["representatives"]), 2)
        self.assertEqual(len(grouped["overlap_disagreements"]), 1)
        relation = parent_relations(room, [unit])[0]
        self.assertEqual(relation["child_overlap_fraction"], 1)
        self.assertTrue(relation["hypothesis_only"])


if __name__ == "__main__":
    unittest.main()
