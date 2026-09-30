"""Fabricated private reviews only; no customer drawing or model is opened."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
import torch

import contract
import review_adapt
from review_adapt import select_review_validation, run, read_completed
from context_review_data import build
from test_context_review_data import fixture, alias_payload
from build_data import model_split
from evaluate_feedback import job_split
from common import file_hash, canonical_hash
from network import supervised_loss


def reviewed_fixture(root):
    args, payload = fixture(root)
    jobs = {split: next(f"adapt-{split}-{i}" for i in range(200) if job_split(f"adapt-{split}-{i}") == "development" and model_split(f"reviewed-job:adapt-{split}-{i}") == split) for split in ("train", "validation")}
    first = alias_payload(payload, jobs["train"], "training", 1)
    second = alias_payload(payload, jobs["validation"], "validation", 1)
    pdf, image = args.feedback[0].parent / "source-validation.pdf", args.feedback[0].parent / "validation.png"
    pdf.write_bytes(b"%PDF-1.7 second separate source fixture")
    Image.new("RGB", (100, 100), (253, 253, 253)).save(image)
    floor = second["floors"][0]
    floor["sourceDrawing"].update(path=pdf.name, sha256=file_hash(pdf))
    floor["image"].update(path=image.name, sha256=file_hash(image))
    for example in second["examples"]:
        example["sourceReviewHash"] = file_hash(pdf)
        example["detection"] = {"drawingHash": file_hash(pdf)}
    first["floors"] += second["floors"]; first["examples"] += second["examples"]
    args.feedback[0].write_text(json.dumps(first))
    result = build(args)
    path = args.output / "manifest.json"
    return path, result, args, first


def save(path, data):
    path.write_text(json.dumps(data))


class ProvenanceTests(unittest.TestCase):
    def test_real_training_and_validation_approvals_replay_with_unknown_openings(self):
        with tempfile.TemporaryDirectory() as temporary:
            path, data, _, _ = reviewed_fixture(Path(temporary))
            verified, reviews, _ = contract.preflight(path, expected_base=data["base_manifest_sha256"])
            self.assertEqual(len(reviews), 2)
            self.assertEqual({r["split"] for r in reviews}, {"train", "validation"})
            for row in reviews:
                with np.load(path.parent / row["targets"]) as arrays:
                    self.assertFalse(arrays["known"][2].any())
                    self.assertFalse(arrays["known"][:, 70, 70].any())
            self.assertEqual(verified["records"], data["records"])

    def test_no_reviews_fail_before_array_decoding_or_model_loading(self):
        with tempfile.TemporaryDirectory() as temporary:
            path, data, _, _ = reviewed_fixture(Path(temporary))
            data["records"] = [r for r in data["records"] if r["source"] == "synthetic-msd"]
            save(path, data)
            with patch.object(contract.np, "load") as decode:
                with self.assertRaisesRegex(ValueError, "reviewed positives"):
                    contract.preflight(path, expected_base=data["base_manifest_sha256"])
            decode.assert_not_called()

    def test_missing_review_validation_cannot_fall_back_to_synthetic_loss(self):
        with tempfile.TemporaryDirectory() as temporary:
            path, data, _, _ = reviewed_fixture(Path(temporary))
            data["records"] = [r for r in data["records"] if r["source"] != "reviewed-floor" or r["split"] == "train"]
            save(path, data)
            with self.assertRaisesRegex(ValueError, "validation jobs"):
                contract.metadata_preflight(path, expected_base=data["base_manifest_sha256"])

    def test_rehashed_wrong_labels_and_masks_still_fail_semantic_replay(self):
        for field, index in (("known", (0,70,70)), ("known", (2,30,30)), ("target", (0,30,30)), ("truth", (30,30))):
            with self.subTest(field=field, index=index), tempfile.TemporaryDirectory() as temporary:
                path, data, _, _ = reviewed_fixture(Path(temporary))
                row = next(r for r in data["records"] if r["source"] == "reviewed-floor")
                asset = path.parent / row["targets"]
                with np.load(asset) as archive:
                    arrays = {k: archive[k].copy() for k in archive.files}
                arrays[field][index] = 0 if arrays[field][index] else 1
                np.savez_compressed(asset, **arrays)
                row["targets_sha256"] = file_hash(asset); save(path, data)
                with self.assertRaisesRegex(ValueError, "targets/masks differ"):
                    contract.preflight(path, expected_base=data["base_manifest_sha256"])

    def test_rehashed_loose_overview_mask_fails(self):
        with tempfile.TemporaryDirectory() as temporary:
            path, data, _, _ = reviewed_fixture(Path(temporary))
            row = next(r for r in data["records"] if r["source"] == "reviewed-floor")
            asset = path.parent / row["overview"]
            with np.load(asset) as archive:
                arrays = {k: archive[k].copy() for k in archive.files}
            arrays["known"][0, 0, 0] = 1
            np.savez_compressed(asset, **arrays)
            row["overview_sha256"] = file_hash(asset); save(path, data)
            with self.assertRaisesRegex(ValueError, "overview differs"):
                contract.preflight(path, expected_base=data["base_manifest_sha256"])

    def test_changed_base_replay_row_fails_before_decoding(self):
        with tempfile.TemporaryDirectory() as temporary:
            path, data, _, _ = reviewed_fixture(Path(temporary))
            data["records"][0]["seed"] = 123456
            save(path, data)
            with self.assertRaisesRegex(ValueError, "Synthetic replay rows"):
                contract.metadata_preflight(path, expected_base=data["base_manifest_sha256"])

    def test_rejection_background_policy_cannot_be_enabled(self):
        with tempfile.TemporaryDirectory() as temporary:
            path, data, _, _ = reviewed_fixture(Path(temporary))
            next(r for r in data["records"] if r["source"] == "reviewed-floor")["negative_proposals_used_as_background"] = True
            save(path, data)
            with self.assertRaisesRegex(ValueError, "segmentation negatives"):
                contract.metadata_preflight(path, expected_base=data["base_manifest_sha256"])

    def test_alternate_preview_cannot_replace_exported_approval_image(self):
        with tempfile.TemporaryDirectory() as temporary:
            path, data, _, _ = reviewed_fixture(Path(temporary))
            row = next(r for r in data["records"] if r["source"] == "reviewed-floor")
            old = row["input_snapshot_hash"]
            Image.new("RGB", (100,100), (177,177,177)).save(path.parent / row["image"])
            alternate = path.parent / "provenance/alternate.png"
            Image.new("RGB", (100,100), (177,177,177)).save(alternate)
            row.update(input_image_snapshot="provenance/alternate.png", input_snapshot_hash=file_hash(alternate), image_sha256=file_hash(path.parent / row["image"]))
            data["provenance_snapshot_hashes"][row["input_image_snapshot"]] = file_hash(alternate)
            data["source_input_hashes"] = {k: file_hash(alternate) if h == old else h for k, h in data["source_input_hashes"].items()}
            save(path, data)
            with self.assertRaisesRegex(ValueError, "exported approval input"):
                contract.preflight(path, expected_base=data["base_manifest_sha256"])

    def test_declared_protected_source_cannot_be_ignored(self):
        with tempfile.TemporaryDirectory() as temporary:
            path, data, _, _ = reviewed_fixture(Path(temporary))
            row = next(r for r in data["records"] if r["source"] == "reviewed-floor")
            data["excluded_review_pdf_sha256"] = [row["drawing_hash"]]
            data["protected_review_sources"] = [{"drawing_sha256": row["drawing_hash"], "source_page": row["source_page"]}]
            save(path, data)
            with patch.object(contract.np, "load") as decode:
                with self.assertRaisesRegex(ValueError, "protected PDFs"):
                    contract.preflight(path, expected_base=data["base_manifest_sha256"])
            decode.assert_not_called()

    def test_omitted_later_export_cannot_bypass_inventory(self):
        with tempfile.TemporaryDirectory() as temporary:
            path, data, _, _ = reviewed_fixture(Path(temporary))
            data["source_input_hashes"]["/never-open/later-export.json"] = "d" * 64
            save(path, data)
            with self.assertRaisesRegex(ValueError, "export inventory"):
                contract.metadata_preflight(path, expected_base=data["base_manifest_sha256"])

    def test_head_order_and_overview_cannot_drift_from_parent(self):
        for key, value in (("heads", ["boundary", "interior", "opening_closure"]), ("overview", 99), ("version", "changed")):
            with self.subTest(key=key), tempfile.TemporaryDirectory() as temporary:
                path, data, _, _ = reviewed_fixture(Path(temporary))
                data[key] = value; save(path, data)
                with self.assertRaisesRegex(ValueError, "Top-level context contract"):
                    contract.metadata_preflight(path, expected_base=data["base_manifest_sha256"])

    def test_duplicate_same_split_pdf_page_cannot_double_weight_review(self):
        with tempfile.TemporaryDirectory() as temporary:
            path, data, _, _ = reviewed_fixture(Path(temporary))
            row = deepcopy(next(r for r in data["records"] if r["source"] == "reviewed-floor" and r["split"] == "train"))
            row["id"] += "-alias"
            data["records"].append(row); save(path, data)
            with self.assertRaisesRegex(ValueError, "Duplicate reviewed PDF/page"):
                contract.metadata_preflight(path, expected_base=data["base_manifest_sha256"])

    def test_later_holdout_pdf_alias_is_blocked_before_target_decode(self):
        with tempfile.TemporaryDirectory() as temporary:
            path, data, _, payload = reviewed_fixture(Path(temporary))
            first = payload["floors"][0]
            subset = {"version": 2, "target": "physical-spaces", "floors": [first], "examples": [e for e in payload["examples"] if e["floorId"] == first["floorId"]]}
            job = next(f"reserved-{i}" for i in range(200) if job_split(f"reserved-{i}") == "holdout")
            protected = alias_payload(subset, job, "protected", 3)
            asset = path.parent / "provenance/review-export-protected.json"
            asset.write_text(json.dumps(protected))
            data["provenance_snapshot_hashes"][str(asset.relative_to(path.parent))] = file_hash(asset)
            data["source_input_hashes"]["/never-open/protected-export.json"] = file_hash(asset)
            pdf = first["sourceDrawing"]["sha256"]
            data["excluded_review_pdf_sha256"] = [pdf]
            data["protected_review_sources"] = [{"drawing_sha256": pdf, "source_page": 3}]
            save(path, data)
            with patch.object(contract.np, "load") as decode:
                with self.assertRaisesRegex(ValueError, "protected PDF alias"):
                    contract.preflight(path, expected_base=data["base_manifest_sha256"])
            decode.assert_not_called()


class TrainingPolicyTests(unittest.TestCase):
    def test_sampling_mass_is_half_review_even_when_reviews_are_rare(self):
        rows = [{"source": "synthetic-msd"} for _ in range(80)] + [{"source": "reviewed-floor"}]
        weights = contract.adaptation_weights(rows, 4)
        self.assertAlmostEqual(sum(weights[:-4]), 0.5)
        self.assertAlmostEqual(sum(weights[-4:]), 0.5)
        with self.assertRaises(ValueError):
            contract.adaptation_weights(rows[:-1], 4)

    def test_selection_uses_review_validation_only(self):
        data = SimpleNamespace(records=[{"source": "synthetic-msd"}, {"source": "reviewed-floor"}], snapshots=["synthetic", "review"])
        select_review_validation(data)
        self.assertEqual(data.snapshots, ["review"])

    def test_partial_supervision_teaches_known_pixels_without_unknown_gradients(self):
        logits = torch.zeros((1,3,8,8), requires_grad=True)
        target, known = torch.zeros_like(logits), torch.zeros_like(logits)
        target[:,0,2:6,2:6] = 1; known[:,:2,2:6,2:6] = 1
        before = float(supervised_loss(logits, target, known).detach())
        optimizer = torch.optim.SGD([logits], lr=0.5)
        for _ in range(20):
            optimizer.zero_grad(); supervised_loss(logits, target, known).backward()
            self.assertTrue(bool((logits.grad[known == 0] == 0).all()))
            optimizer.step()
        self.assertLess(float(supervised_loss(logits, target, known).detach()), before)
        self.assertTrue(bool((logits.detach()[known == 0] == 0).all()))

    def test_model_outputs_cannot_be_written_inside_repository(self):
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            run(Path("does-not-exist"), Path(__file__).parent / "unsafe", "cpu")


def completion_fixture(root):
    import shutil
    parent = root / "parent"
    parent.mkdir()
    (parent / "best.pt").write_bytes(b"fabricated parent, never decoded")
    (parent / "run.json").write_text("{\"fixture_parent\":true}")
    parent_sha, parent_run_sha = file_hash(parent / "best.pt"), file_hash(parent / "run.json")
    claims = root / "review-adaptation-claims"
    claims.mkdir()
    output = root / "output"
    output.mkdir()
    manifest = root / "manifest.json"
    manifest.write_text("{}")
    sources = review_adapt.producer_sources()
    runtime = review_adapt.runtime_versions()
    claim = claims / (canonical_hash({"manifest": file_hash(manifest), "parent": parent_sha, "config": contract.CONFIG}) + ".json")
    value = {"output": str(output.resolve()), "manifest_sha256": file_hash(manifest), "parent_sha256": parent_sha,
             "config": contract.CONFIG, "sources": {str(p): h for p, h in sources.items()}, "runtime": runtime}
    claim.write_text(json.dumps(value))
    (output / "best.pt").write_bytes(b"fabricated tensor container, never decoded")
    inputs = {str(manifest): file_hash(manifest), str(parent / "best.pt"): parent_sha,
              str(parent / "run.json"): parent_run_sha, str(claim): file_hash(claim)}
    for p, h in sources.items():
        dest = output / "frozen_sources" / p.parent.name / p.name
        dest.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(p, dest)
        inputs[str(dest)] = h
    binding = {**value, "manifest": str(manifest), "parent_run_sha256": parent_run_sha,
               "claim": str(claim), "claim_sha256": file_hash(claim), "inputs": inputs,
               "reviewed_training_floors": 1, "reviewed_validation_floors": 1, "approved_for_production": False}
    (output / "binding.json").write_text(json.dumps(binding))
    report = {"output": str(output), "claim": str(claim), "claim_sha256": file_hash(claim),
              "binding_sha256": file_hash(output / "binding.json"), "checkpoint_sha256": file_hash(output / "best.pt"),
              "manifest_sha256": file_hash(manifest), "parent_checkpoint_sha256": parent_sha, "parent_run_sha256": parent_run_sha,
              "config": contract.CONFIG, "source_hashes": review_adapt.source_hashes(), "runtime": runtime,
              "version": review_adapt.VERSION, "heads": list(review_adapt.HEADS), "architecture": "rgb-overview-conditioned-local-unet",
              "base": 16, "context_base": 8, "tile": 512, "overview": 512, "adaptation": "verified-review-warm-start-v1",
              "approved_for_production": False, "history": [{"epoch": i, "loss": {"train": 1., "validation": 1. / i}, "elapsed_seconds": i} for i in range(1,13)],
              "selected_epoch": 12,
              "selection": "Lowest masked loss on separate reviewed validation jobs; never every-room accuracy.",
              "sampling": "Half expected training sampling mass on current reviews, half on unchanged synthetic replay."}
    (output / "run.json").write_text(json.dumps(report))
    completion = {"output": str(output.resolve()), "claim": str(claim), "claim_sha256": file_hash(claim), "binding_sha256": file_hash(output / "binding.json"), "run_sha256": file_hash(output / "run.json"), "checkpoint_sha256": file_hash(output / "best.pt"), "approved_for_production": False}
    (output / "completed.json").write_text(json.dumps(completion))
    claim.with_suffix(".completed.json").write_text(json.dumps({**completion, "completed_sha256": file_hash(output / "completed.json")}))
    return parent, output, claim


class CompletionTests(unittest.TestCase):
    def test_original_completed_chain_accepts_and_tamper_rejects(self):
        for change in ("binding.json", "best.pt", "claim", "input"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                parent, output, claim = completion_fixture(root)
                with patch.multiple(review_adapt, PARENT_DIR=parent, PARENT_SHA=file_hash(parent / "best.pt"), PARENT_RUN_SHA=file_hash(parent / "run.json")):
                    self.assertFalse(read_completed(output)["approved_for_production"])
                    changed = claim if change == "claim" else root / "manifest.json" if change == "input" else output / change
                    changed.write_bytes(changed.read_bytes() + b"changed")
                    with self.assertRaises((ValueError, RuntimeError)):
                        read_completed(output)

    def test_copied_directory_is_not_an_original_completed_run(self):
        import shutil
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            parent, output, _ = completion_fixture(root)
            copy = root / "copy"
            shutil.copytree(output, copy)
            with patch.multiple(review_adapt, PARENT_DIR=parent, PARENT_SHA=file_hash(parent / "best.pt"), PARENT_RUN_SHA=file_hash(parent / "run.json")):
                with self.assertRaisesRegex(ValueError, "Copied output"):
                    read_completed(copy)

    def test_rehashed_incomplete_run_cannot_be_a_completion(self):
        for field, value in (("history", []), ("selected_epoch", 1), ("approved_for_production", True), ("heads", [])):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temporary:
                parent, output, claim = completion_fixture(Path(temporary))
                report = json.loads((output / "run.json").read_text()); report[field] = value
                save(output / "run.json", report)
                completion = json.loads((output / "completed.json").read_text())
                completion["run_sha256"] = file_hash(output / "run.json")
                save(output / "completed.json", completion)
                save(claim.with_suffix(".completed.json"), {**completion, "completed_sha256": file_hash(output / "completed.json")})
                with patch.multiple(review_adapt, PARENT_DIR=parent, PARENT_SHA=file_hash(parent / "best.pt"), PARENT_RUN_SHA=file_hash(parent / "run.json")):
                    with self.assertRaises(ValueError):
                        read_completed(output)

    def test_checkpoint_changed_after_first_hash_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent, output, _ = completion_fixture(Path(temporary))
            changed = False
            def drift(path):
                nonlocal changed
                digest = file_hash(path)
                if Path(path) == output / "best.pt" and not changed:
                    changed = True; Path(path).write_bytes(b"late replacement")
                return digest
            with patch.multiple(review_adapt, PARENT_DIR=parent, PARENT_SHA=file_hash(parent / "best.pt"), PARENT_RUN_SHA=file_hash(parent / "run.json")), patch.object(review_adapt, "file_hash", drift):
                with self.assertRaisesRegex(RuntimeError, "Frozen input changed"):
                    read_completed(output)

    def test_selected_checkpoint_drift_fails_before_replacement(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / "best.pt").write_bytes(b"selection")
            digest = file_hash(root / "best.pt")
            (root / "best.pt").write_bytes(b"replaced")
            with self.assertRaisesRegex(ValueError, "Selected checkpoint changed"):
                review_adapt.check_selected(root, digest)


if __name__ == "__main__":
    unittest.main()
