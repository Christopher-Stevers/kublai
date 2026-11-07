import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from adapter import CHECKPOINT_SHA, blocked_training, checkpoint_state, digest, extract_definitions, resize_metadata, safe_checkpoint, unpad_point


class AdapterTests(unittest.TestCase):
    def test_checkpoint_is_digest_pinned_before_any_pickle_inspection(self):
        with patch("adapter.digest", return_value="incorrect"), patch("torch.serialization.get_unsafe_globals_in_checkpoint") as scanner:
            with self.assertRaisesRegex(ValueError, "unverified checkpoint"):
                safe_checkpoint(Path("never-opened"))
            scanner.assert_not_called()

    def test_checkpoint_loader_uses_only_namespace_and_weights_only(self):
        with patch("adapter.digest", return_value=CHECKPOINT_SHA), patch("torch.serialization.get_unsafe_globals_in_checkpoint", return_value=["argparse.Namespace"]), patch("torch.load", return_value={"model": 17}) as load:
            self.assertEqual(safe_checkpoint(Path("fabricated")), {"model": 17})
            self.assertTrue(load.call_args.kwargs["weights_only"])
        with patch("adapter.digest", return_value=CHECKPOINT_SHA), patch("torch.serialization.get_unsafe_globals_in_checkpoint", return_value=["untrusted.Payload"]), patch("torch.load") as load:
            with self.assertRaisesRegex(ValueError, "undeclared"):
                safe_checkpoint(Path("fabricated"))
            load.assert_not_called()

    def test_checkpoint_mutation_after_decode_fails(self):
        with patch("adapter.digest", side_effect=[CHECKPOINT_SHA, "changed"]), patch("torch.serialization.get_unsafe_globals_in_checkpoint", return_value=[]), patch("torch.load", return_value={}):
            with self.assertRaisesRegex(ValueError, "changed"):
                safe_checkpoint(Path("fabricated"))

    def test_official_attention_reference_bilinear_center_and_zero_padding(self):
        import torch
        import torch.nn.functional as F
        upstream = Path("/home/tim/datasets/foremanhq-room-detection/raster2seq/upstream/models/ops/functions/ms_deform_attn_func.py")
        if not upstream.exists():
            self.skipTest("optional pinned upstream checkout is not installed")
        core = extract_definitions(upstream, {"ms_deform_attn_core_pytorch"}, {"torch": torch, "F": F})["ms_deform_attn_core_pytorch"]
        value = torch.tensor([1., 2., 3., 4.]).reshape(1, 4, 1, 1)
        shapes = torch.tensor([[2, 2]])
        locations = torch.tensor([[[[[[.5, .5]]]], [[[[2., 2.]]]]]])
        weights = torch.ones(1, 2, 1, 1, 1)
        actual = core(value, shapes, locations, weights)
        self.assertTrue(torch.allclose(actual, torch.tensor([[[2.5], [0.]]])))

    def test_only_declared_saved_runtime_caches_are_discarded(self):
        state = {"module.weight": 17, "transformer.decoder.layers.5.kv_cache.k_cache": 1, "transformer.decoder.layers.6.kv_cache.k_cache": 2, "transformer.decoder.layers.5.kv_cache.fake_cache": 3}
        clean, ignored = checkpoint_state(state)
        self.assertEqual(ignored, ["transformer.decoder.layers.5.kv_cache.k_cache"])
        self.assertEqual(len(clean), 3)
        self.assertEqual(clean["weight"], 17)

    def test_non_square_roundtrip_with_pixel_centers(self):
        meta = resize_metadata(701, 499)
        box = [123, 45, 824, 544]
        for x, y in [(0, 0), (700, 498), (350.2, 12.7)]:
            mx = (x + .5) * meta["new_width"] / 701 - .5 + meta["left"]
            my = (y + .5) * meta["new_height"] / 499 - .5 + meta["top"]
            fx, fy = unpad_point([mx, my], meta, box, [5000, 3750])
            self.assertAlmostEqual(fx * 5000, x + box[0])
            self.assertAlmostEqual(fy * 3750, y + box[1])

    def test_padding_not_silently_clipped(self):
        meta = resize_metadata(1000, 100)
        self.assertLess(unpad_point([0, 0], meta, [0, 0, 1000, 100], [1000, 100])[1], 0)

    def test_odd_padding_and_invalid_resize(self):
        m = resize_metadata(701, 499)
        self.assertEqual(m["new_width"], 256)
        self.assertEqual(m["top"], (256 - m["new_height"]) // 2)
        with self.assertRaises(ValueError):
            resize_metadata(0, 3)

    def test_unused_training_fails(self):
        with self.assertRaises(RuntimeError):
            blocked_training()

    def test_extract_does_not_execute_other_definitions_or_imports(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "source.py"
            path.write_text("raise RuntimeError('top level')\ndef f(): return 17\ndef hidden(): raise RuntimeError('bad')\n")
            self.assertEqual(extract_definitions(path, {"f"}, {})["f"](), 17)
            with self.assertRaises(ValueError):
                extract_definitions(path, {"missing"}, {})

    def test_streamed_digest(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "x"
            p.write_bytes(b"abc")
            self.assertEqual(digest(p), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")


if __name__ == "__main__":
    unittest.main()
