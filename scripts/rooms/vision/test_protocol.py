from __future__ import annotations

import json
import copy
import hashlib
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from common import (CONTEXT_EXPERIMENT, CONTEXT_HEADS, PROTECTED_MANIFEST_SHA256, PROTECTED_SITES, checked_bytes,
                    checked_development_records, parse_census, point_coverage,
                    regular_viewports, source_coordinates, verify_hashes, write_json)
from download import (MODEL, REVISION, PINNED_FILES, file_hash, verified_asset, verified_provenance)
from pilot import PresencePenalty, checked_completion, finalize_run, score_results


def development_fixture():
    records = []
    for index, split in enumerate(("train", "validation", "validation")):
        ident = f"fake-{index}"
        records.append({"id": ident, "source": "synthetic-msd", "split": split, "site": f"900{index}",
                        "image": f"{ident}.png", "targets": f"{ident}.npz",
                        "image_sha256": hashlib.sha256(ident.encode()).hexdigest(), "targets_sha256": "1" * 64})
    return {"version": "structural-room-challenger-v1", "experiment": CONTEXT_EXPERIMENT,
            "heads": CONTEXT_HEADS, "protected_manifest_sha256": PROTECTED_MANIFEST_SHA256,
            "excluded_msd_sites": sorted(PROTECTED_SITES), "records": records}


def pinned_provenance():
    return {"model": MODEL, "revision": REVISION, "license": "apache-2.0",
            "files": {name: {"bytes": size, "sha256": digest} for name, (size, digest) in PINNED_FILES.items()}}


class CensusProtocol(unittest.TestCase):
    def test_whole_manifest_contract_is_validated_before_selection(self):
        fixture = development_fixture()
        self.assertEqual([r["id"] for r in checked_development_records(fixture)], ["fake-1", "fake-2"])
        for key, value in (("version", "foreign"), ("experiment", "holdout"), ("heads", ["interior"]),
                           ("protected_manifest_sha256", "0" * 64), ("excluded_msd_sites", [])):
            changed = copy.deepcopy(fixture); changed[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                checked_development_records(changed)

    def test_protected_site_or_split_anywhere_in_manifest_is_rejected(self):
        fixture = development_fixture()
        for field, value in (("split", "holdout"), ("site", next(iter(PROTECTED_SITES)))):
            changed = copy.deepcopy(fixture); changed["records"][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                checked_development_records(changed)

    def test_site_and_image_aliases_cannot_cross_development_splits(self):
        fixture = development_fixture()
        for field in ("site", "image_sha256"):
            changed = copy.deepcopy(fixture)
            changed["records"][1][field] = changed["records"][0][field]
            changed["records"][1]["group"] = "a-different-alias"
            with self.subTest(field=field), self.assertRaises(ValueError):
                checked_development_records(changed)

    def test_case_and_asset_paths_cannot_escape_private_output_or_source(self):
        fixture = development_fixture()
        for field in ("id", "image", "targets"):
            changed = copy.deepcopy(fixture); changed["records"][0][field] = "../outside"
            with self.subTest(field=field), self.assertRaises(ValueError):
                checked_development_records(changed)

    def test_all_model_assets_and_exact_identity_are_required(self):
        verified_provenance(pinned_provenance())
        for mutation in ("omitted-config", "extra-path", "wrong-model", "same-size-tokenizer"):
            value = pinned_provenance()
            if mutation == "omitted-config": del value["files"]["config.json"]
            elif mutation == "extra-path": value["files"]["../outside"] = value["files"]["config.json"]
            elif mutation == "wrong-model": value["model"] = "another-model"
            else: value["files"]["tokenizer.json"]["sha256"] = "0" * 64
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                verified_provenance(value)

    def test_same_sized_existing_model_asset_cannot_bypass_hash_check(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "config.json"
            path.write_bytes(b" " * PINNED_FILES["config.json"][0])
            with self.assertRaises(ValueError):
                verified_asset(path, "config.json")

    def test_decoded_image_or_target_uses_the_bytes_whose_hash_was_checked(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "fabricated-asset"; path.write_bytes(b"original")
            expected = file_hash(path)
            snapshot = checked_bytes(path, expected)
            path.write_bytes(b"mutated")
            self.assertEqual(snapshot, b"original")
            with self.assertRaises(ValueError): checked_bytes(path, expected)
    def test_viewport_transform_retains_page_origin_and_separates_inferred_seeds(self):
        value = parse_census(json.dumps({"building_regions": [{"bbox_2d": [0, 0, 1000, 1000]}],
                                       "spaces": [{"point_2d": [250, 750], "kind": "unknown"}]}))
        result = source_coordinates(value, [200, 100, 600, 300], [1000, 500])
        self.assertEqual(result["spaces"][0]["source_point_px"], [300, 250])
        self.assertEqual(result["spaces"][0]["source_point_normalized"], [.3, .5])
        self.assertEqual(result["building_regions"][0]["source_bbox_normalized"], [.2, .2, .6, .6])
        self.assertEqual(result["supplied_seeds"], [])
        self.assertIsNone(result["outline_geometry"])

    def test_truncated_or_invalid_output_is_failure_instead_of_repaired_partial_census(self):
        bad = ['{"spaces": []', '{"spaces": [], "building_regions": [], "extra": 0}',
               '{"spaces": [{"point_2d": [NaN, 4], "kind": "room"}], "building_regions": []}',
               '{"spaces": [{"point_2d": [True, 4], "kind": "room"}], "building_regions": []}',
               '{"spaces": [], "building_regions": [{"bbox_2d": [10, 0, 5, 10]}]}']
        for text in bad:
            with self.subTest(text=text), self.assertRaises(ValueError):
                parse_census(text)

    def test_regular_crops_depend_only_on_dimensions_and_cover_odd_sized_pages(self):
        self.assertEqual(regular_viewports(9, 7), [[0, 0, 9, 7], [0, 0, 4, 3], [4, 0, 9, 3],
                                                 [0, 3, 4, 7], [4, 3, 9, 7]])

    def test_point_recall_penalizes_missing_rooms_duplicates_and_wall_points(self):
        import numpy as np
        truth = np.array([[1, 1, 0, 2], [1, 1, 0, 2], [0, 0, 3, 3]], dtype="i4")
        result = point_coverage(truth, [[0, 0], [1, 1], [2, 0], [3, 0], [4, 0]])
        self.assertEqual((result["rooms_hit"], result["rooms_missed"]), (2, 1))
        self.assertEqual((result["duplicate_room_points"], result["outside_room_points"]), (1, 2))
        self.assertIsNone(result["boundary_accuracy"])

    def test_provenance_change_and_overwrite_are_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "private.json"
            write_json(path, {"frozen": True})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            snapshot = {path: file_hash(path)}
            with self.assertRaises(FileExistsError):
                write_json(path, {})
            path.write_text("{}")
            with self.assertRaises(ValueError):
                verify_hashes(snapshot)

    def test_presence_penalty_counts_generated_token_once_and_excludes_prompt(self):
        import torch
        tokens = torch.tensor([[1, 2, 3, 3, 4]])
        scores = torch.zeros((1, 6))
        result = PresencePenalty(prompt_length=2, penalty=1.5)(tokens, scores)
        self.assertEqual(result.tolist(), [[0, 0, 0, -1.5, -1.5, 0]])
        self.assertEqual(scores.tolist(), [[0, 0, 0, 0, 0, 0]])


class CompletionFences(unittest.TestCase):
    def emitted(self, output):
        path = output / "fake-viewport-0.json"
        return {str(path.resolve()): file_hash(path)}

    def fixture(self, root):
        output = Path(root) / "results"; output.mkdir()
        plan_path = Path(root) / "plan.json"; write_json(plan_path, {"fabricated": True})
        asset = Path(root) / "fake-input"; asset.write_bytes(b"frozen")
        model = Path(root) / "fake-model"; model.mkdir()
        weights = model / "weights"; weights.write_bytes(b"fake-weights")
        runtime = {"fabricated": "1"}
        plan = {"source_hashes": {"fake.py": "0" * 64}, "inputs": {str(asset): file_hash(asset)},
                "cases": [{"id": "fake", "viewports": [[0, 0, 2, 2]]}]}
        result = output / "fake-viewport-0.json"; write_json(result, {"fabricated": True})
        return plan_path, plan, model, {str(weights): file_hash(weights)}, runtime, output

    def test_completed_manifest_binds_exact_result_and_changed_result_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            values = self.fixture(root); plan_path, plan, model, hashes, runtime, output = values
            with patch("pilot.load_plan", return_value=plan), patch("pilot.runtime_versions", return_value=runtime), patch("pilot.checked_model", return_value=hashes):
                finalize_run(*values, file_hash(plan_path), self.emitted(output))
                marker, _ = checked_completion(plan_path, plan, output)
                self.assertEqual(set(marker["result_hashes"]), {str(output / "fake-viewport-0.json")})
                (output / "fake-viewport-0.json").write_text("changed")
                with self.assertRaises(ValueError): checked_completion(plan_path, plan, output)

    def test_late_input_model_runtime_or_plan_change_never_finalizes(self):
        for mutation in ("input", "model", "runtime", "plan"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as root:
                values = self.fixture(root); plan_path, plan, model, hashes, runtime, output = values
                original = file_hash(plan_path)
                emitted = self.emitted(output)
                final_hashes, final_runtime = dict(hashes), dict(runtime)
                if mutation == "input": Path(next(iter(plan["inputs"]))).write_bytes(b"changed")
                elif mutation == "model": final_hashes[next(iter(hashes))] = "0" * 64
                elif mutation == "runtime": final_runtime["fabricated"] = "2"
                else: plan_path.write_text("{\"same semantic intent\":true}")
                with patch("pilot.load_plan", return_value=plan), patch("pilot.runtime_versions", return_value=final_runtime), patch("pilot.checked_model", return_value=final_hashes):
                    with self.assertRaises(ValueError): finalize_run(*values, original, emitted)
                self.assertFalse((output / "completed-run.json").exists())

    def test_partial_result_directory_cannot_finalize(self):
        with tempfile.TemporaryDirectory() as root:
            values = self.fixture(root); plan_path, plan, model, hashes, runtime, output = values
            plan["cases"][0]["viewports"].append([2, 0, 4, 2])
            with patch("pilot.load_plan", return_value=plan), patch("pilot.runtime_versions", return_value=runtime), patch("pilot.checked_model", return_value=hashes):
                with self.assertRaises(ValueError): finalize_run(*values, file_hash(plan_path), self.emitted(output))
            self.assertFalse((output / "completed-run.json").exists())

    def test_result_changed_after_emission_cannot_be_captured_as_valid_at_finalization(self):
        with tempfile.TemporaryDirectory() as root:
            values = self.fixture(root); plan_path, plan, model, hashes, runtime, output = values
            emitted = self.emitted(output)
            (output / "fake-viewport-0.json").write_text("changed before final capture")
            with patch("pilot.load_plan", return_value=plan), patch("pilot.runtime_versions", return_value=runtime), patch("pilot.checked_model", return_value=hashes):
                with self.assertRaises(ValueError): finalize_run(*values, file_hash(plan_path), emitted)
            self.assertFalse((output / "completed-run.json").exists())

    def test_missing_completion_is_rejected_before_ground_truth_decode(self):
        with tempfile.TemporaryDirectory() as root:
            plan_path, plan, model, hashes, runtime, output = self.fixture(root)
            args = SimpleNamespace(plan=plan_path, results=output, output=Path(root) / "score.json")
            with patch("pilot.load_plan", return_value=plan), patch("numpy.load", side_effect=AssertionError("GT must not decode")) as decode:
                with self.assertRaises(ValueError): score_results(args)
                decode.assert_not_called()


if __name__ == "__main__":
    unittest.main()
