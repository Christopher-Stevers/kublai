"""Fabricated fixtures only: no existing/protected corpus pixels are read."""
import json
import shutil
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

from common import HEADS, VERSION, file_hash, read_manifest, source_hashes
from context_train import read_context_manifest
import context_generalization as generalization


def fixture(root):
    def save(name, value):
        path = root / name
        path.write_text(json.dumps(value))
        return path

    protected = save("protected.json", [{"site": f"protected-{index}"} for index in range(89)])
    pilot = save("pilot.json", {"version": VERSION, "records": [
        {"id": "pilot-train", "site": "pilot-train", "split": "train"},
        {"id": "pilot-validation", "site": "pilot-validation", "split": "validation"}]})
    context = save("context.json", {"version": VERSION, "records": [
        {"id": "context-train", "site": "context-train", "split": "train"},
        {"id": "validation-page", "site": "context-validation", "split": "validation"}]})
    checkpoint = root / "checkpoint.pt"
    checkpoint.write_bytes(b"fabricated checkpoint, never decoded")
    report = save("development.json", {"split": "new-whole-sheet-model-development",
        "checkpoint_sha256": file_hash(checkpoint), "manifest_sha256": file_hash(context),
        "tiling": {"overlap": 128}, "thresholds": {"boundary": 0.5, "interior": 0.35},
        "source_hashes": source_hashes(),
        "results": {"context": {"cases": [{"id": "validation-page", "status": "ok", "metrics": {"tp50": 1}}]}}})
    selection = root / "selection.json"
    generalization.freeze_selection(SimpleNamespace(checkpoint=checkpoint, development_report=report,
                                                   native_preset=None, output=selection))
    msd = root / "fabricated.jsonl"
    sites = ["protected-0", "pilot-train", "pilot-validation", "context-train", "context-validation", "unseen-a", "unseen-b"]
    msd.write_text("\n".join(json.dumps({"id": f"layout-{site}", "site_id": site}) for site in sites))
    args = SimpleNamespace(selection=selection, checkpoint=checkpoint, msd=msd, protected_manifest=protected,
                           pilot_manifest=pilot, context_manifest=context, output=root / "corpus",
                           cases=2, seed=123, without_geometry=True)
    metadata = {"manifest_sha256": file_hash(context), "tile": 32, "overview": 32}
    return args, metadata


def sheet_fixture(choices, seed):
    image = Image.new("RGB", (20, 20), "white")
    target = np.zeros((3, 20, 20), dtype=np.uint8)
    target[0, 4:16, 4:16] = 1
    target[1, 3, 3:17] = target[1, 16, 3:17] = 1
    target[1, 3:17, 3] = target[1, 3:17, 16] = 1
    truth = np.zeros((20, 20), dtype=np.int32)
    truth[4:16, 4:16] = 1
    return image, target, np.ones_like(target), truth, None, None, [choices[0]["id"]]


class GeneralizationTests(unittest.TestCase):
    def test_roi_selection_replays_point_four_instead_of_fixed_baseline(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            args, metadata = fixture(root)
            report_path = root / "roi-development.json"
            report_path.write_text(json.dumps({"split": "fixed-whole-sheet-model-development",
                "checkpoint_sha256": file_hash(args.checkpoint), "manifest_sha256": file_hash(args.context_manifest),
                "source_hashes": source_hashes(), "presets": generalization.ROI_PRESETS,
                "results": {"baseline_low_barrier": {"cases": [
                    {"id": "validation-page", "status": "ok", "metrics": {"tp50": 1}}]}}}))
            args.selection = root / "roi-selection.json"
            selected = generalization.freeze_selection(SimpleNamespace(checkpoint=args.checkpoint,
                development_report=report_path, native_preset=None, roi_preset="baseline_low_barrier", output=args.selection))
            self.assertEqual(selected["inference"]["boundary"], 0.4)
            self.assertEqual(selected["roi_parameters"], generalization.ROI_PRESETS["baseline_low_barrier"])
            with patch.object(generalization, "load_context_model", return_value=(None, metadata)), \
                    patch.object(generalization, "sheet_case", side_effect=sheet_fixture):
                generalization.build(args)
            evaluate_args = SimpleNamespace(manifest=args.output / "manifest.json", checkpoint=args.checkpoint,
                output=root / "evaluation", device="cpu", threads=1, node="node")
            probability = sheet_fixture([{"id": "unused"}], 0)[1].astype(np.float32)
            original = generalization.bounded_rooms
            with patch.object(generalization, "load_context_model", return_value=(None, metadata)), \
                    patch.object(generalization, "context_probabilities", return_value=(probability, None)), \
                    patch.object(generalization, "bounded_rooms", wraps=original) as decode:
                scored = generalization.evaluate(evaluate_args)
            self.assertEqual(scored["inference"]["boundary"], 0.4)
            self.assertEqual(scored["roi_preset"], "baseline_low_barrier")
            self.assertEqual(decode.call_count, 2)
            self.assertEqual(decode.call_args.args[1], "baseline_low_barrier")
            selected["roi_parameters"]["boundary"] = 0.5
            args.selection.write_text(json.dumps(selected))
            with self.assertRaisesRegex(ValueError, "ROI parameters"):
                generalization.read_selection(args.selection, args.checkpoint)

    def test_unscored_native_roi_combination_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            args, _ = fixture(Path(temporary))
            with self.assertRaisesRegex(ValueError, "combinations have not been scored"):
                generalization.freeze_selection(SimpleNamespace(checkpoint=args.checkpoint,
                    development_report=Path(temporary) / "development.json", native_preset="native_walls",
                    roi_preset="baseline_low_barrier", output=Path(temporary) / "mixed-selection.json"))

    def test_all_prior_splits_and_protected_sites_are_excluded_before_render(self):
        with tempfile.TemporaryDirectory() as temporary:
            args, metadata = fixture(Path(temporary))
            rendered = []
            def render(choices, seed):
                rendered.append(choices[0]["site_id"])
                return sheet_fixture(choices, seed)
            with patch.object(generalization, "load_context_model", return_value=(None, metadata)), \
                    patch.object(generalization, "sheet_case", side_effect=render):
                manifest = generalization.build(args)
            self.assertEqual(set(rendered), {"unseen-a", "unseen-b"})
            self.assertEqual(len(manifest["excluded_msd_sites"]), 93)
            self.assertEqual(len({case["site"] for case in manifest["records"]}), 2)
            self.assertEqual((args.output.stat().st_mode & 0o777), 0o700)
            for reader in (read_manifest, read_context_manifest):
                with self.assertRaisesRegex(ValueError, "Unsupported"):
                    reader(args.output / "manifest.json")

    def test_completed_selection_and_checkpoint_are_required_before_new_geometry(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            args, _ = fixture(root)
            data = json.loads(args.selection.read_text())
            data["selection_complete"] = False
            args.selection.write_text(json.dumps(data))
            with patch.object(generalization, "sheet_case") as render:
                with self.assertRaisesRegex(ValueError, "completed"):
                    generalization.build(args)
                render.assert_not_called()
            data["selection_complete"] = True
            args.selection.write_text(json.dumps(data))
            args.checkpoint.write_bytes(b"different checkpoint")
            with self.assertRaisesRegex(ValueError, "selected checkpoint"):
                generalization.build(args)
            self.assertFalse(args.output.exists())

    def test_incomplete_development_report_and_forged_selection_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            args, _ = fixture(root)
            report = root / "development.json"
            data = json.loads(report.read_text())
            data["results"]["context"]["cases"][0]["status"] = "error"
            report.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, "completed development"):
                generalization.freeze_selection(SimpleNamespace(checkpoint=args.checkpoint, development_report=report,
                                                               native_preset=None, output=root / "bad-selection.json"))
            selection = json.loads(args.selection.read_text())
            selection["development_case_ids"] = ["omitted-validation-page"]
            args.selection.write_text(json.dumps(selection))
            with self.assertRaisesRegex(ValueError, "immutable completed"):
                generalization.read_selection(args.selection, args.checkpoint)

    def test_builder_refuses_source_input_mutation_and_no_second_corpus(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            args, metadata = fixture(root)
            def mutate(choices, seed):
                args.msd.write_text(args.msd.read_text() + "\n")
                return sheet_fixture(choices, seed)
            with patch.object(generalization, "load_context_model", return_value=(None, metadata)), \
                    patch.object(generalization, "sheet_case", side_effect=mutate):
                with self.assertRaisesRegex(RuntimeError, "Frozen input changed"):
                    generalization.build(args)
            self.assertFalse((args.output / "manifest.json").exists())
            args.output = root / "second-corpus"
            with patch.object(generalization, "load_context_model", return_value=(None, metadata)):
                with self.assertRaises(FileExistsError):
                    generalization.build(args)

    def test_distinct_unseen_site_contract_rejects_aliases_and_prior_sites(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            args, metadata = fixture(root)
            with patch.object(generalization, "load_context_model", return_value=(None, metadata)), \
                    patch.object(generalization, "sheet_case", side_effect=sheet_fixture):
                generalization.build(args)
            path = args.output / "manifest.json"
            data = json.loads(path.read_text())
            data["records"][1]["site"] = data["records"][0]["site"]
            path.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, "distinct"):
                generalization.read_generalization_manifest(path)
            data["records"][1]["site"] = "pilot-validation"
            path.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, "protected/development"):
                generalization.read_generalization_manifest(path)

    def test_once_only_full_room_and_head_scores_are_checkpoint_bound(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            build_args, metadata = fixture(root)
            with patch.object(generalization, "load_context_model", return_value=(None, metadata)), \
                    patch.object(generalization, "sheet_case", side_effect=sheet_fixture):
                manifest = generalization.build(build_args)
            args = SimpleNamespace(manifest=build_args.output / "manifest.json", checkpoint=build_args.checkpoint,
                                   output=root / "evaluation", device="cpu", threads=1, node="node")
            probability = sheet_fixture([{"id": "unused"}], 0)[1].astype(np.float32)
            with patch.object(generalization, "load_context_model", return_value=(None, metadata)), \
                    patch.object(generalization, "context_probabilities", return_value=(probability, None)):
                report = generalization.evaluate(args)
            result = report["results"]["selected_model"]
            self.assertEqual(result["summary"]["f1_50"], 1)
            self.assertEqual(result["pixel_summary"]["interior"]["tp"], 288)
            self.assertEqual(result["pixel_summary"]["interior"]["fn"], 0)
            self.assertEqual(report["checkpoint_sha256"], manifest["selected_checkpoint_sha256"])
            self.assertEqual(report["inference"], generalization.FIXED)
            args.output = root / "second-evaluation"
            with patch.object(generalization, "load_context_model", return_value=(None, metadata)), \
                    patch.object(generalization.np, "load") as decode:
                with self.assertRaises(FileExistsError):
                    generalization.evaluate(args)
                decode.assert_not_called()
            self.assertFalse((args.output / "report.json").exists())

    def test_copied_corpus_cannot_bypass_original_selection_attempt(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            build_args, metadata = fixture(root)
            with patch.object(generalization, "load_context_model", return_value=(None, metadata)), \
                    patch.object(generalization, "sheet_case", side_effect=sheet_fixture):
                generalization.build(build_args)
            copied = root / "copied-corpus"
            shutil.copytree(build_args.output, copied)
            args = SimpleNamespace(manifest=build_args.output / "manifest.json", checkpoint=build_args.checkpoint,
                                   output=root / "evaluation", device="cpu", threads=1, node="node")
            probability = sheet_fixture([{"id": "unused"}], 0)[1].astype(np.float32)
            with patch.object(generalization, "load_context_model", return_value=(None, metadata)), \
                    patch.object(generalization, "context_probabilities", return_value=(probability, None)):
                generalization.evaluate(args)
            args.manifest, args.output = copied / "manifest.json", root / "copied-evaluation"
            with patch.object(generalization.np, "load") as decode, \
                    patch.object(generalization, "load_context_model") as load:
                with self.assertRaisesRegex(ValueError, "original resolved corpus"):
                    generalization.evaluate(args)
                decode.assert_not_called()
                load.assert_not_called()
            # Removing the corpus-local marker still cannot bypass the canonical
            # selection marker when attempting the original corpus again.
            (build_args.output / "EVALUATION_STARTED.json").unlink()
            args.manifest, args.output = build_args.output / "manifest.json", root / "retried-evaluation"
            with patch.object(generalization, "load_context_model", return_value=(None, metadata)), \
                    patch.object(generalization.np, "load") as decode:
                with self.assertRaises(FileExistsError):
                    generalization.evaluate(args)
                decode.assert_not_called()

    def test_copied_selection_rejected_and_symlink_uses_original_binding(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            args, metadata = fixture(root)
            copied = root / "copied-selection.json"
            shutil.copyfile(args.selection, copied)
            with self.assertRaisesRegex(ValueError, "original resolved path"):
                generalization.read_selection(copied, args.checkpoint)
            with patch.object(generalization, "load_context_model", return_value=(None, metadata)), \
                    patch.object(generalization, "sheet_case", side_effect=sheet_fixture):
                generalization.build(args)
            alias = root / "selection-alias.json"
            alias.symlink_to(args.selection)
            args.selection, args.output = alias, root / "another-output"
            with patch.object(generalization, "load_context_model", return_value=(None, metadata)):
                with self.assertRaises(FileExistsError):
                    generalization.build(args)


if __name__ == "__main__":
    unittest.main()
