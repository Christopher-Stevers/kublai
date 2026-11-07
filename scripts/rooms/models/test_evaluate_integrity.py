"""Original evaluator must bind scored pixels to initially frozen bytes."""
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

from common import file_hash
from test_context import context_fixture

# build_data adds complete/ to sys.path, which also contains evaluate.py.
# Load the exact original model evaluator rather than that executable script.
spec = importlib.util.spec_from_file_location("original_model_evaluation", Path(__file__).with_name("evaluate.py"))
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


class OriginalEvaluationIntegrityTests(unittest.TestCase):
    def test_mutated_image_target_or_checkpoint_cannot_reach_geometry_or_report(self):
        for changed in ("image", "targets", "checkpoint"):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                manifest, data = context_fixture(root)
                data["records"][0]["split"] = "validation"
                manifest.write_text(json.dumps(data))
                checkpoint = root / "checkpoint.pt"
                checkpoint.write_bytes(b"fabricated immutable checkpoint")
                metadata = {"manifest_sha256": file_hash(manifest), "tile": 32}
                args = SimpleNamespace(manifest=manifest, checkpoint=checkpoint, output=root / "evaluation",
                    limit=1, device="cpu", threads=1, overlap=8, boundary_threshold=.5,
                    interior_threshold=.35, geometry=True, node="node")
                def mutate(*unused):
                    if changed == "image":
                        Image.new("RGB", (96, 64), "white").save(root / "page.png")
                    elif changed == "targets":
                        (root / "target.npz").write_bytes(b"changed target after decoding")
                    else:
                        checkpoint.write_bytes(b"changed checkpoint after loading")
                    return np.zeros((3, 64, 96), dtype=np.float32)
                with patch.object(evaluation, "load_model", return_value=(None, metadata)), \
                        patch.object(evaluation, "stitched_probabilities", side_effect=mutate), \
                        patch.object(evaluation, "geometry_runtime", return_value={}), \
                        patch.object(evaluation.subprocess, "run") as geometry:
                    with self.assertRaisesRegex(RuntimeError, "Frozen input changed"):
                        evaluation.run(args)
                    geometry.assert_not_called()
                self.assertFalse((args.output / "report.json").exists())


if __name__ == "__main__":
    unittest.main()
