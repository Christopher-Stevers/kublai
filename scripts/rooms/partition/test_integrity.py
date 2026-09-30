"""Fabricated cache/source/corpus guards; no actual drawing or protected data."""
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np

from evaluate import ALLOWED_CHECKPOINT, ALLOWED_DEVELOPMENT, ALLOWED_MANIFEST, checked_probabilities, digest, freeze, read_binding, sources, validate_binding_metadata, verify
from partition import FIXED, PRESETS, partition_rooms


class BindingTests(unittest.TestCase):
    def test_other_manifest_is_rejected_before_other_assets_are_resolved(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "another-corpus.json"
            path.write_text(json.dumps({"version": "once-only-generated-sites", "records": []}))
            with self.assertRaisesRegex(ValueError, "metadata hash differs"):
                freeze(SimpleNamespace(manifest=path))

    def test_probability_hash_checked_before_and_after_decode(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "probability.npz"
            np.savez(path, probability=np.zeros((3, 5, 6), dtype=np.float32))
            original = digest(path)
            with patch("evaluate.np.load") as load:
                with self.assertRaisesRegex(ValueError, "bytes changed"):
                    checked_probabilities(path, "a" * 64)
                load.assert_not_called()
            real_load = np.load

            def mutate(*args, **kwargs):
                result = real_load(*args, **kwargs)
                path.write_bytes(path.read_bytes() + b"mutated")
                return result

            with patch("evaluate.np.load", side_effect=mutate):
                with self.assertRaisesRegex(ValueError, "during decoding"):
                    checked_probabilities(path, original)

    def test_source_mutation_and_binding_copy_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "binding.json"
            binding = {"binding_path": str(path), "source_hashes": sources(), "input_hashes": {},
                       "presets": PRESETS, "fixed": FIXED}
            path.write_text(json.dumps(binding))
            with patch("evaluate.validate_binding_metadata"):
                read_binding(path)
            duplicate = Path(tmp) / "copied-binding.json"
            duplicate.write_bytes(path.read_bytes())
            with self.assertRaisesRegex(ValueError, "original frozen binding"):
                read_binding(duplicate)
            with patch("evaluate.sources", return_value={}):
                with self.assertRaisesRegex(RuntimeError, "sources/settings changed"):
                    verify(binding)

    def test_binding_original_identities_are_rechecked_before_asset_access(self):
        with patch("evaluate.pinned_json") as read:
            with self.assertRaisesRegex(ValueError, "original bound"):
                validate_binding_metadata({"version": "forged"})
            read.assert_not_called()

    def test_duplicate_development_ids_cannot_hide_missing_page(self):
        records = [{"id": f"page-{i}", "split": "validation"} for i in range(20)]
        binding = {"version": "learned-marker-partition-v1", "manifest_sha256": ALLOWED_MANIFEST,
                   "checkpoint_sha256": ALLOWED_CHECKPOINT, "development_report_sha256": ALLOWED_DEVELOPMENT,
                   "input_hashes": {"/fake/manifest": ALLOWED_MANIFEST, "/fake/weights": ALLOWED_CHECKPOINT,
                                    "/fake/report": ALLOWED_DEVELOPMENT},
                   "cases": [{"id": "page-0"} for _ in range(20)]}
        with patch("evaluate.pinned_json", side_effect=[{"records": records}, {}]):
            with self.assertRaisesRegex(ValueError, "unique original 20"):
                validate_binding_metadata(binding)

    def test_ground_truth_is_not_a_partitioner_input(self):
        with self.assertRaises(TypeError):
            partition_rooms(np.zeros((3, 50, 60)), "weighted_basins", truth=np.zeros((50, 60)))


if __name__ == "__main__":
    unittest.main()
