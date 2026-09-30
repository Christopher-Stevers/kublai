"""Fabricated contracts only; no corpus pixels/GPU are needed."""
import copy
import unittest
import numpy as np
from contract import CONFIG, PRIOR_SHA, validate_arrays, validate_metadata, verify
from pathlib import Path
from tempfile import TemporaryDirectory
import hashlib
import json
from unittest.mock import patch
import contract
from contract import claim_trial, validate_completion


def metadata():
    sites = [str(n) for n in range(173)]
    prior = [{"sha256": sha, "sites": sites if n == 0 else []} for n, sha in enumerate(sorted(PRIOR_SHA))]
    rows = []
    for n, split in enumerate(("train", "validation")):
        rows.append(dict(id=f"floor-{n}", split=split, source="swiss-dwellings-real-geometry", site=f"new-{n}",
                         group=f"group-{n}", component_aliases=[f"site:new-{n}", f"floor:{n}"], image_sha256=str(n),
                         render_stats=dict(physical_room_ground_truth_certified=False, all_space_scoring_eligible=False,
                                           human_completeness_evidence=False, generated_geometry_pixel_development_eligible=True,
                                           real_door_coordinates=True, functional_area_outlines_used_as_barriers=False,
                                           wall_ink_style="solid-0",wall_ink_parameters=contract.WALL_STYLES["solid-0"],nuisance_ink_changes_targets=False)))
    return dict(dataset_contract="swiss-true-openings-ink-v4", overview=512, physical_room_ground_truth_certified=False,
                all_space_scoring_eligible=False, human_completeness_evidence=False, approved_for_production=False,
                validation_is_development=True, prior_manifests=prior, excluded_msd_sites=sites,
                ink_baseline_manifest_sha256=contract.V3_SHA, ink_only_change_verified=True,
                target_overview_reference_assets_identical_to_v3=True, wall_ink_styles_predeclared=contract.WALL_STYLES,
                wall_ink_style_counts={"solid-0":2}, simulated_nuisance_policy={"changes_source_targets_or_references":False},
                counts={"train": 1, "validation": 1}, records=rows)


class ContractTests(unittest.TestCase):
    def test_fixed_defaults_and_derived_eligibility(self):
        self.assertEqual(CONFIG["epochs"], 48); self.assertEqual(CONFIG["seed"], 20260930)
        validate_metadata(metadata(), {"train": 1, "validation": 1})
        for field in ("physical_room_ground_truth_certified", "all_space_scoring_eligible", "human_completeness_evidence"):
            data = metadata(); data["records"][0]["render_stats"][field] = True
            with self.assertRaises(ValueError): validate_metadata(data, data["counts"])

    def test_component_alias_and_prior_site_rejected_before_assets(self):
        data = metadata(); data["records"][1]["component_aliases"].append("floor:0")
        with self.assertRaises(ValueError): validate_metadata(data, data["counts"])
        data = metadata(); data["records"][1]["component_aliases"].append("site:40")
        with self.assertRaises(ValueError): validate_metadata(data, data["counts"])

    def test_counts_and_prior_role_pins(self):
        data = metadata(); data["records"].pop()
        with self.assertRaises(ValueError): validate_metadata(data, data["counts"])

    def test_ink_only_target_and_style_binding(self):
        data = metadata(); data["target_overview_reference_assets_identical_to_v3"] = False
        with self.assertRaises(ValueError): validate_metadata(data,data["counts"])
        data=metadata(); data["records"][0]["render_stats"]["nuisance_ink_changes_targets"] = True
        with self.assertRaises(ValueError): validate_metadata(data,data["counts"])
        data = metadata(); data["prior_manifests"][0]["sha256"] = "fake"
        with self.assertRaises(ValueError): validate_metadata(data, data["counts"])

    def test_unknown_positive_openings_remain_legal(self):
        t = np.ones((3, 4, 5), np.uint8); k = np.zeros_like(t)
        validate_arrays(t, k, t.shape)
        t[2, 1, 1] = 2
        with self.assertRaises(ValueError): validate_arrays(t, k, t.shape)

    def test_hash_mutation_fails(self):
        with TemporaryDirectory() as tmp:
            p = Path(tmp) / "asset"; p.write_bytes(b"frozen")
            frozen = {str(p): hashlib.sha256(b"frozen").hexdigest()}
            verify(frozen); p.write_bytes(b"changed")
            with self.assertRaises(RuntimeError): verify(frozen)

    def test_experiment_claim_cannot_repeat_under_another_output(self):
        with TemporaryDirectory() as tmp, patch.object(contract, "CLAIM", Path(tmp) / "claim.json"):
            claim_trial(Path(tmp) / "first", {}, {})
            with self.assertRaises(FileExistsError): claim_trial(Path(tmp) / "second", {}, {})

    def test_completion_requires_full_run_exact_selection_and_defaults(self):
        binding = {"archived_sources": {"models/common.py": "frozen"}, "runtime": {"torch": "a", "cuda": "b"}}
        run = dict(config=CONFIG.copy(), manifest_sha256=contract.DATA_SHA, source_hashes={"common.py": "frozen"},
                   parameters=2456454, heads=list(contract.HEADS), runtime=binding["runtime"],
                   history=[dict(epoch=n, loss={"train": .5, "validation": 1/n}) for n in range(1,49)])
        saved = {k:v for k,v in run.items() if k != "history"}; saved["selected_epoch"] = 48
        validate_completion(run, saved, binding)
        for mutate in (lambda v: v.update(selected_epoch=47), lambda v: v["config"].update(lr=.02),
                       lambda v: v.update(source_hashes={"common.py": "changed"})):
            bad = copy.deepcopy(saved); mutate(bad)
            with self.assertRaises(ValueError): validate_completion(run, bad, binding)
        run["history"].pop()
        with self.assertRaises(ValueError): validate_completion(run, saved, binding)

    def test_checkpoint_changed_during_decode_is_rejected(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp); (root / "training").mkdir()
            binding = root / "binding.json"; binding.write_text("{}")
            checkpoint = root / "training/best.pt"; checkpoint.write_bytes(b"first")
            sha = hashlib.sha256(b"first").hexdigest()
            run = root / "training/run.json"; run.write_text(json.dumps({"manifest_sha256":contract.DATA_SHA,"checkpoint_sha256":sha}))
            completed = dict(binding_sha256=contract.file_hash(binding), run_sha256=contract.file_hash(run), checkpoint_sha256=sha)
            (root / "completed.json").write_text(json.dumps(completed))
            def load(*args, **kwargs):
                checkpoint.write_bytes(b"late change")
                return {"metadata_json":"{}"}
            with patch.object(contract,"read_training_binding",return_value={"assets":{},"source_bindings":{},"runtime":{}}), \
                 patch.object(contract,"validate_completion"), patch("torch.load",side_effect=load), patch.object(contract,"verify_runtime"):
                with self.assertRaises(RuntimeError): contract.completed_checkpoint(binding)


if __name__ == "__main__": unittest.main()
