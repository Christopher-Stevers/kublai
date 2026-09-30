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


class InkStyleTests(unittest.TestCase):
    def fixture(self):
        # Includes a genuine wall hole, opening, unknown area and source stairs.
        wall = Polygon([(4, 0), (6, 0), (6, 10), (4, 10)], holes=[[(4.5, 7), (5.5, 7), (5.5, 8), (4.5, 8)]])
        return [entity(box(0, 0, 10, 10), st="STAIRCASE", usage="PUBLIC"),
                entity(wall, "separator", "WALL"), entity(box(3.8, 4, 6.2, 5), "opening", "DOOR"),
                entity(box(0, 8, 2, 10), st="NOT_DEFINED"), entity(box(.5, .5, 3.5, 3.5), "feature", "STAIRS")]

    def test_every_wall_style_and_nuisance_changes_only_ink_not_targets_or_references(self):
        rows = self.fixture(); source_wkt = [r["geometry"].wkt for r in rows]
        baseline = build.render(rows, 42, 640, 512, wall_style="solid-0", add_simulated_nuisance=False)
        baseline_coarse = build.coarse_targets(baseline[1], baseline[2])
        images = set()
        for style in build.WALL_STYLES:
            for nuisance in (False, True):
                image, target, known, truth, stats = build.render(rows, 42, 640, 512, wall_style=style, add_simulated_nuisance=nuisance)
                if nuisance:
                    images.add(np.asarray(image).tobytes())
                self.assertEqual(target.tobytes(), baseline[1].tobytes())
                self.assertEqual(known.tobytes(), baseline[2].tobytes())
                self.assertEqual(truth.tobytes(), baseline[3].tobytes())
                self.assertEqual(json.dumps(stats["source_area_references"], sort_keys=True),
                                 json.dumps(baseline[4]["source_area_references"], sort_keys=True))
                self.assertEqual([r["geometry"].wkt for r in rows], source_wkt)
                coarse = build.coarse_targets(target, known)
                self.assertEqual(coarse[0].tobytes(), baseline_coarse[0].tobytes())
                self.assertEqual(coarse[1].tobytes(), baseline_coarse[1].tobytes())
        self.assertEqual(len(images), len(build.WALL_STYLES))

    def test_gray_wall_ink_and_paired_white_interiors_are_physical_positives(self):
        rows = self.fixture()
        for style in ["solid-180", "solid-220", "paired-white-1", "paired-white-2", "paired-gray-1", "paired-gray-2"]:
            image, target, _, _, stats = build.render(rows, 42, 640, 512, wall_style=style, add_simulated_nuisance=False)
            y, x = sample(stats, 640, 512, 5, 2)
            self.assertEqual(target[1, y, x], 1)
            self.assertEqual(np.asarray(image)[y, x, 0], build.WALL_STYLES[style]["fill"])

    def test_true_openings_erased_after_all_paired_or_solid_wall_ink(self):
        rows = self.fixture(); width, height = 640, 512
        coordinate = lambda x, y: (40 + x * 30, 400 - y * 30)
        solid = build.polygon_mask(rows[1]["geometry"], width, height, coordinate)
        doors = build.polygon_mask(rows[2]["geometry"], width, height, coordinate)
        for style in build.WALL_STYLES:
            layer = build.wall_ink_layer(rows, solid, doors, np.zeros_like(doors), coordinate, width, height, style)
            self.assertTrue((np.asarray(layer)[doors] == 255).all())

    def test_simulated_furniture_and_treads_are_bounded_nonstructural_known_interior_ink(self):
        rows = [entity(box(0, 0, 10, 10), st="STAIRCASE", usage="PUBLIC"),
                entity(box(2, 2, 8, 8), "feature", "STAIRS")]
        plain = build.render(rows, 5, 640, 512, wall_style="solid-0", add_simulated_nuisance=False)
        full = build.render(rows, 5, 640, 512, wall_style="solid-0")
        self.assertGreater(full[4]["simulated_furniture_count"], 0)
        self.assertLessEqual(full[4]["simulated_furniture_count"], build.MAX_SIMULATED_FURNITURE)
        self.assertGreater(full[4]["simulated_stair_tread_count"], 0)
        self.assertLessEqual(len(full[4]["simulated_stair_features"]), build.MAX_SIMULATED_STAIR_FEATURES)
        changed = np.any(np.asarray(plain[0]) != np.asarray(full[0]), axis=2)
        self.assertTrue(changed.any()); self.assertTrue(full[1][0][changed].all())
        self.assertFalse(full[1][1:].any())
        for i in (1, 2, 3):
            self.assertEqual(plain[i].tobytes(), full[i].tobytes())
        self.assertFalse(full[4]["nuisance_ink_is_source_geometry"])

    def test_style_and_nuisance_are_deterministic_without_scoring_or_search(self):
        a = build.render(self.fixture(), 91, 640, 512); b = build.render(self.fixture(), 91, 640, 512)
        self.assertEqual(np.asarray(a[0]).tobytes(), np.asarray(b[0]).tobytes())
        self.assertEqual(a[4]["wall_ink_style"], b[4]["wall_ink_style"])
        self.assertEqual(a[4]["simulated_furniture"], b[4]["simulated_furniture"])


if __name__ == "__main__":
    unittest.main()
