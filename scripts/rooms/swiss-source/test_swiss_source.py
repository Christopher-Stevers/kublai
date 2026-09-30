"""Fabricated cases only: do not decode any source/protected evaluation geometry."""
import csv
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from shapely.geometry import Polygon, box

spec = importlib.util.spec_from_file_location("swiss_build", Path(__file__).with_name("build.py"))
build = importlib.util.module_from_spec(spec); spec.loader.exec_module(build)


def entity(geom, t="area", st="ROOM", usage="RESIDENTIAL"):
    return {"geometry": geom, "entity_type": t, "entity_subtype": st, "unit_usage": usage, "area_id": "1", "unit_id": "1"}


def metadata_row(site, plan, floor, *, geometry="MUST_NOT_DECODE", st="ROOM", t="area"):
    return {"site_id": site, "building_id": "building-" + str(site), "floor_id": floor, "plan_id": plan,
            "entity_type": t, "entity_subtype": st, "unit_usage": "PUBLIC", "geometry": geometry}


def csv_file(root, rows):
    path = root / "fabricated.csv"
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
    return path


def sample(stats, width, height, x, y):
    minx, miny, maxx, maxy = stats["source_bounds"]; scale = stats["pixels_per_source_meter"]
    return round((maxy - y) * scale + round(height * .07)), round((x - minx) * scale + round(width * .055))


class ExclusionTests(unittest.TestCase):
    def test_duplicate_or_unpinned_prior_role_inputs_fail_closed(self):
        with tempfile.TemporaryDirectory() as d:
            paths = []
            for i in range(4):
                p = Path(d) / f"prior{i}.json"; p.write_text(json.dumps({"untrusted": i})); paths.append(p)
            with self.assertRaisesRegex(ValueError, "independently pinned"):
                build.prior_exclusions(paths)
            with self.assertRaisesRegex(ValueError, "Duplicate prior manifest"):
                build.prior_exclusions([paths[0], paths[1], paths[1], paths[3]])

    def test_all_four_prior_manifests_union_metadata_only(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); paths = []
            for i in range(4):
                p = root / f"prior{i}.json"; paths.append(p)
                rows = [{"site": str(i + 1), "image": "DO_NOT_OPEN.png", "targets": "DO_NOT_OPEN.npz"}]
                p.write_text(json.dumps(rows if i == 0 else {"records": rows, "excluded_msd_sites": ["099.0"]}))
            excluded, info = build.prior_exclusions(paths, require_complete=False)
            self.assertEqual(excluded, {"1", "2", "3", "4", "99"}); self.assertEqual(len(info), 4)

    def test_protected_site_and_alias_excluded_before_wkt_decoder(self):
        with tempfile.TemporaryDirectory() as d:
            rows = [metadata_row("012", "shared", "f1"), metadata_row("fresh", "shared", "f2"),
                    metadata_row("safe", "unique", "f3", geometry="SAFE_FABRICATED_GEOMETRY")]
            p = csv_file(Path(d), rows); floors, summary = build.metadata_preflight(p, {"12"})
            self.assertFalse(summary["geometry_decoded_at_preflight"])
            self.assertTrue(floors[("fresh", "building-fresh", "f2", "shared")]["protected"])
            selected = [{**floors[("safe", "building-safe", "f3", "unique")], "split": "train"}]
            seen = []
            def decoder(text):
                seen.append(text); return box(0, 0, 1, 1)
            decoded, _ = build.decode_selected(p, selected, {"12"}, decoder)
            self.assertEqual(seen, ["SAFE_FABRICATED_GEOMETRY"]); self.assertEqual(len(decoded), 1)
            with self.assertRaisesRegex(ValueError, "Protected alias"):
                build.decode_selected(p, [{**floors[("12", "building-012", "f1", "shared")], "split": "train"}], {"12"}, decoder)
            self.assertEqual(len(seen), 1)

    def test_site_and_repeated_plan_floor_alias_cannot_cross_splits(self):
        with tempfile.TemporaryDirectory() as d:
            rows = [metadata_row("a", "same-plan", "floor-a"), metadata_row("b", "same-plan", "floor-b")]
            p = csv_file(Path(d), rows); floors, _ = build.metadata_preflight(p, set())
            a, b = list(floors.values())
            self.assertEqual(a["group"], b["group"])
            with self.assertRaisesRegex(ValueError, "alias crosses splits"):
                build.validate_selection([{**a, "split": "train"}, {**b, "split": "validation"}])

    def test_repeated_floor_alias_protects_cross_site_alias(self):
        with tempfile.TemporaryDirectory() as d:
            p = csv_file(Path(d), [metadata_row("old", "p1", "same-floor"), metadata_row("new", "p2", "same-floor")])
            floors, _ = build.metadata_preflight(p, {"old"})
            self.assertTrue(all(m["protected"] for m in floors.values()))

    def test_missing_identity_fails_before_decoder(self):
        with self.assertRaisesRegex(ValueError, "Missing grouping"):
            build.identities(metadata_row("1", "", "floor"))


class RenderTests(unittest.TestCase):
    def test_genuine_door_targets_only_source_opening_no_simulated_gaps(self):
        rows = [entity(box(0, 0, 10, 10)), entity(box(4.8, 0, 5.2, 10), "separator", "WALL"),
                entity(box(4.7, 4, 5.3, 5), "opening", "DOOR"), entity(box(1, 1, 2, 2), "feature", "TOILET")]
        image, target, known, truth, stats = build.render(rows, 7, 640, 512)
        y, x = sample(stats, 640, 512, 5, 4.5)
        self.assertEqual(target[2, y, x], 1); self.assertEqual(target[1, y, x], 1)
        y, x = sample(stats, 640, 512, 5, 7)
        self.assertEqual(target[2, y, x], 0); self.assertEqual(target[1, y, x], 1)
        y, x = sample(stats, 640, 512, 1.5, 1.5)
        self.assertEqual(target[1, y, x], 0)  # source fixture is not a structural barrier
        self.assertEqual(target[0, y, x], 1)
        self.assertEqual(stats["provisional_components"], 2)
        self.assertFalse(stats["all_space_scoring_eligible"])
        self.assertIn("algorithm-derived", stats["truth_reference_kind"])

    def test_adjacent_functional_areas_do_not_generate_wall_or_two_rooms(self):
        rows = [entity(box(0, 0, 5, 5), st="LIVING_DINING"), entity(box(5, 0, 10, 5), st="KITCHEN")]
        _, target, _, truth, stats = build.render(rows, 2, 640, 512)
        self.assertFalse(target[1].any()); self.assertFalse(target[2].any())
        self.assertEqual(stats["provisional_components"], 1)
        self.assertFalse(stats["functional_area_outlines_used_as_barriers"])
        self.assertEqual(len(stats["source_area_references"]), 2)
        self.assertEqual({ref["derived_instance_memberships"][0]["instance_id"] for ref in stats["source_area_references"]}, {1})
        self.assertEqual({ref["subtype"] for ref in stats["source_area_references"]}, {"LIVING_DINING", "KITCHEN"})
        self.assertEqual([ref["physical_area_m2"] for ref in stats["source_area_references"]], [25, 25])

    def test_unknown_unsupervised_outdoor_nonroom_and_public_corridor(self):
        rows = [entity(box(0, 0, 2, 4), st="CORRIDOR", usage="PUBLIC"),
                entity(box(2, 0, 4, 4), st="NOT_DEFINED"), entity(box(4, 0, 6, 4), st="BALCONY")]
        _, target, known, truth, stats = build.render(rows, 3, 640, 512)
        y, x = sample(stats, 640, 512, 1, 2)
        self.assertEqual(target[0, y, x], 1); self.assertTrue(known[:, y, x].all())
        y, x = sample(stats, 640, 512, 3, 2)
        self.assertFalse(known[:, y, x].any()); self.assertEqual(truth[y, x], 0)
        y, x = sample(stats, 640, 512, 5, 2)
        self.assertTrue(known[:, y, x].all()); self.assertEqual(target[0, y, x], 0); self.assertEqual(truth[y, x], 0)
        self.assertTrue(stats["source_semantics_partial"]); self.assertFalse(stats["all_space_scoring_eligible"])

    def test_named_common_halls_and_small_spaces_remain_indoor_references(self):
        for subtype in ["CORRIDORS_AND_HALLS", "COMMUNITY_ROOM", "COMMON_KITCHEN", "FOYER", "BIKE_STORAGE",
                        "PRAM_AND_BIKE_STORAGE_ROOM", "BASEMENT", "TECHNICAL_AREA", "ELECTRICAL_SUPPLY", "ELEVATOR", "STAIRCASE"]:
            with self.subTest(subtype=subtype):
                _, target, known, _, stats = build.render([entity(box(0, 0, 2, 2), st=subtype, usage="PUBLIC")], 5, 640, 512)
                self.assertTrue(target[0].any()); self.assertFalse(stats["source_semantics_partial"])
                self.assertEqual(stats["source_area_references"][0]["supervision"], "interior")

    def test_polygon_holes_preserved_in_interior_and_component_reference(self):
        polygon = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)], holes=[[(4, 4), (6, 4), (6, 6), (4, 6)]])
        _, target, known, truth, stats = build.render([entity(polygon, st="CORRIDOR", usage="PUBLIC")], 3, 640, 512)
        y, x = sample(stats, 640, 512, 5, 5)
        self.assertEqual(target[0, y, x], 0); self.assertEqual(truth[y, x], 0)
        self.assertEqual(stats["source_area_references"][0]["holes"], 1)
        y, x = sample(stats, 640, 512, 2, 2)
        self.assertEqual(target[0, y, x], 1)

    def test_overview_preserves_any_unknown_source_footprint(self):
        target = np.zeros((3, 1024, 1024), dtype=np.uint8); known = np.ones_like(target)
        known[:, 20, 20] = 0; target[1, 500, 500] = 1
        coarse, supervision = build.coarse_targets(target, known)
        self.assertTrue(coarse[1].any()); self.assertFalse(supervision[:, 10, 10].any())


if __name__ == "__main__":
    unittest.main()
