import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
import torch

from build_sheet_data import overview_targets
from common import HEADS, VERSION as MANIFEST_VERSION, file_hash
from context_network import ContextUNet, aligned_context
from context_predict import context_probabilities, run as run_context_prediction
from context_train import ContextTiles, read_context_manifest
from context_evaluate import full_space_case, run as run_context_evaluation


class ContextTests(unittest.TestCase):
    def test_partial_reviews_cannot_establish_complete_floor_metrics(self):
        self.assertTrue(full_space_case({"source": "synthetic-msd"}))
        self.assertFalse(full_space_case({"source": "reviewed-floor", "completeness_attested": False,
                                         "full_space_evaluation_eligible": True}))
        self.assertFalse(full_space_case({"source": "reviewed-floor", "completeness_attested": True}))
        self.assertFalse(full_space_case({"source": "reviewed-floor", "completeness_attested": "yes",
                                         "full_space_evaluation_eligible": True}))
        self.assertTrue(full_space_case({"source": "reviewed-floor", "completeness_attested": True,
                                        "full_space_evaluation_eligible": True}))

    def test_context_crop_uses_native_page_coordinates(self):
        x = (torch.arange(32).float() + 0.5) / 32
        y = (torch.arange(32).float() + 0.5) / 32
        overview = torch.stack([x[None].expand(32, -1), y[:, None].expand(-1, 32), torch.ones(32, 32)])[None]
        boxes = torch.tensor([[0.25, 0.5, 0.75, 1.0]])
        result = aligned_context(overview, boxes, (8, 8))
        self.assertAlmostEqual(float(result[0, 0, 4, 0]), 0.28125, places=5)
        self.assertAlmostEqual(float(result[0, 0, 4, 7]), 0.71875, places=5)
        self.assertAlmostEqual(float(result[0, 1, 0, 4]), 0.53125, places=5)
        self.assertAlmostEqual(float(result[0, 1, 7, 4]), 0.96875, places=5)

    def test_thin_boundaries_survive_overview_downsample(self):
        target = np.zeros((3, 128, 128), dtype=np.uint8)
        target[1, :, 63] = 1
        target[2, 50:60, 63] = 1
        known = np.ones_like(target)
        small, mask = overview_targets(target, known, 16)
        self.assertGreater(int(small[1].sum()), 0)
        self.assertGreater(int(small[2].sum()), 0)
        self.assertTrue(np.all(mask == 1))

    def test_overview_never_turns_unknown_pixels_into_dense_background(self):
        target = np.zeros((3, 128, 128), dtype=np.uint8)
        known = np.zeros_like(target)
        known[0, 50:70, 50:70] = 1
        _, mask = overview_targets(target, known, 16)
        self.assertLess(int(mask.sum()), 16)
        self.assertFalse(np.any(mask[1:]))

    def test_one_unknown_pixel_masks_the_entire_overview_area_footprint(self):
        target = np.zeros((3, 128, 128), dtype=np.uint8)
        known = np.ones_like(target)
        known[0, 5, 5] = 0
        _, mask = overview_targets(target, known, 16)
        self.assertEqual(int(mask[0, 0, 0]), 0)
        self.assertEqual(int(mask[0].sum()), 16 * 16 - 1)
        self.assertTrue(np.all(mask[1:] == 1))

    def test_fractional_overview_footprints_keep_any_overlapping_unknown_unsupervised(self):
        target = np.zeros((3, 5, 7), dtype=np.uint8)
        known = np.ones_like(target)
        known[0, 1, 2] = 0
        _, mask = overview_targets(target, known, 3)
        # Native cell [2,3]x[1,2] crosses two rows and two columns of the
        # noninteger 7/3 by 5/3 overview grid; all four outputs stay unknown.
        self.assertTrue(np.all(mask[0, :2, :2] == 0))
        self.assertEqual(int(mask[0].sum()), 5)

    def test_local_loss_backpropagates_into_whole_sheet_context(self):
        torch.set_num_threads(2)
        torch.manual_seed(13)
        model = ContextUNet(8, 8)
        tiles = torch.rand(1, 3, 32, 32)
        overview = torch.rand(1, 3, 64, 64)
        local, coarse = model(tiles, overview, torch.tensor([[0.25, 0.25, 0.75, 0.75]]))
        self.assertEqual(tuple(local.shape), (1, 3, 32, 32))
        self.assertEqual(tuple(coarse.shape), (1, 3, 64, 64))
        local.square().mean().backward()
        self.assertGreater(float(model.overview.output.weight.grad.abs().sum()), 0)


def context_fixture(root):
    """A coordinate-encoded fabricated page; no corpus or holdout inputs."""
    width, height, overview_size = 96, 64, 32
    image = np.zeros((height, width, 3), dtype=np.uint8)
    image[:, :, 0] = np.linspace(0, 255, width).astype(np.uint8)[None]
    image[:, :, 1] = np.linspace(0, 255, height).astype(np.uint8)[:, None]
    image[:, :, 2] = 255
    target = np.stack([image[:, :, 0] > 127, image[:, :, 1] > 127, np.zeros((height, width))]).astype(np.uint8)
    known = np.ones_like(target)
    coarse, coarse_known = overview_targets(target, known, overview_size)
    Image.fromarray(image).save(root / "page.png")
    np.savez(root / "target.npz", target=target, known=known, truth=np.zeros((height, width), dtype=np.int32))
    np.savez(root / "overview.npz", target=coarse, known=coarse_known)
    record = {"id": "fabricated-page", "source": "synthetic-msd", "site": "fabricated-site",
              "group": "msd-site:fabricated-site", "split": "train", "image": "page.png",
              "image_sha256": file_hash(root / "page.png"), "targets": "target.npz",
              "targets_sha256": file_hash(root / "target.npz"), "overview": "overview.npz",
              "overview_sha256": file_hash(root / "overview.npz")}
    data = {"version": MANIFEST_VERSION, "heads": list(HEADS), "experiment": "whole-sheet-context-v2",
            "excluded_msd_sites": [], "overview": overview_size, "records": [record]}
    path = root / "manifest.json"
    path.write_text(json.dumps(data))
    return path, data


class ContextAssetAndCoordinateTests(unittest.TestCase):
    def test_rotated_and_flipped_tile_targets_and_overview_stay_aligned(self):
        with tempfile.TemporaryDirectory() as temporary:
            path, _ = context_fixture(Path(temporary))
            tiles = ContextTiles(path, "train", tile=32, patches=24, seed=123)
            for index in range(len(tiles)):
                image, overview, boxes, target, known, _, _ = tiles[index]
                self.assertTrue(torch.all(known == 1))
                self.assertTrue(torch.equal(target[0].bool(), image[0] > 127 / 255))
                self.assertTrue(torch.equal(target[1].bool(), image[1] > 127 / 255))
                aligned = aligned_context(overview[None], boxes[None], (32, 32))[0]
                # Coordinate ramps independently reveal a wrong overview crop,
                # rotation, or reflection. Ignore the resampler's page-edge band.
                self.assertTrue(torch.allclose(aligned[:2, 4:-4, 4:-4], image[:2, 4:-4, 4:-4], atol=0.012))

    def test_training_uses_immutable_snapshots_after_assets_change(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path, _ = context_fixture(root)
            tiles = ContextTiles(path, "train", tile=32, patches=1, seed=123)
            expected = tuple(value.clone() for value in tiles[0])
            Image.new("RGB", (96, 64), "white").save(root / "page.png")
            np.savez(root / "target.npz", target=np.zeros((3, 64, 96)), known=np.zeros((3, 64, 96)))
            np.savez(root / "overview.npz", target=np.zeros((3, 32, 32)), known=np.zeros((3, 32, 32)))
            self.assertTrue(all(torch.equal(a, b) for a, b in zip(expected, tiles[0])))
            with self.assertRaisesRegex(ValueError, "hash changed"):
                read_context_manifest(path)

    def test_site_aliases_and_identical_assets_cannot_cross_splits(self):
        with tempfile.TemporaryDirectory() as temporary:
            path, data = context_fixture(Path(temporary))
            second = {**data["records"][0], "id": "another-page", "group": "another-group", "split": "validation"}
            data["records"].append(second)
            path.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, "site"):
                read_context_manifest(path)
            second["site"] = "another-fabricated-site"
            path.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, "Identical"):
                read_context_manifest(path)

    def test_context_inference_computes_one_overview_and_covers_every_native_pixel(self):
        class Constant(torch.nn.Module):
            def __init__(self):
                super().__init__()
                self.overview_calls = 0

            def overview(self, value):
                self.overview_calls += 1
                return torch.zeros((value.shape[0], 3, *value.shape[-2:]))

            def local_logits(self, value, coarse, boxes):
                return torch.zeros((value.shape[0], 3, *value.shape[-2:]))

        model = Constant()
        image = np.ones((23, 79, 3), dtype=np.float32)
        probability, overview = context_probabilities(model, image, tile=32, overlap=8,
                                                       overview_size=32, device=torch.device("cpu"))
        self.assertEqual(model.overview_calls, 1)
        self.assertEqual(probability.shape, (3, 23, 79))
        self.assertEqual(overview.shape, (23, 79))
        self.assertTrue(np.isfinite(probability).all())
        self.assertTrue(np.allclose(probability, 0.5))
        self.assertTrue(np.allclose(overview, 0.5))


class ContextProvenanceTests(unittest.TestCase):
    def test_prediction_refuses_input_changed_after_decoding(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            context_fixture(root)
            checkpoint = root / "checkpoint.pt"
            checkpoint.write_bytes(b"fabricated checkpoint")
            args = SimpleNamespace(image=root / "page.png", checkpoint=checkpoint, output=root / "prediction",
                                   device="cpu", threads=1, overlap=8, boundary_threshold=0.5,
                                   interior_threshold=0.35, min_area=25)
            metadata = {"tile": 32, "overview": 32, "manifest_sha256": "a" * 64}

            def mutate(*unused):
                Image.new("RGB", (96, 64), "white").save(args.image)
                return np.zeros((3, 64, 96), dtype=np.float32), np.zeros((64, 96), dtype=np.float32)

            with patch("context_predict.load_context_model", return_value=(None, metadata)), \
                    patch("context_predict.context_probabilities", side_effect=mutate):
                with self.assertRaisesRegex(RuntimeError, "Frozen input changed"):
                    run_context_prediction(args)
            self.assertFalse((args.output / "prediction.json").exists())

    def test_evaluation_refuses_to_send_a_changed_image_to_geometry(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest, data = context_fixture(root)
            data["records"][0]["split"] = "validation"
            manifest.write_text(json.dumps(data))
            pilot_manifest = root / "pilot-manifest.json"
            pilot_manifest.write_text(json.dumps({"version": MANIFEST_VERSION, "heads": list(HEADS), "records": []}))
            context_checkpoint, pilot_checkpoint = root / "context.pt", root / "pilot.pt"
            context_checkpoint.write_bytes(b"fabricated context checkpoint")
            pilot_checkpoint.write_bytes(b"fabricated pilot checkpoint")
            context_info = {"manifest_sha256": file_hash(manifest), "tile": 32, "overview": 32}
            pilot_info = {"manifest_sha256": file_hash(pilot_manifest), "tile": 32,
                          "config": {"manifest": str(pilot_manifest)}}
            args = SimpleNamespace(manifest=manifest, checkpoint=context_checkpoint, pilot_checkpoint=pilot_checkpoint,
                                   output=root / "evaluation", limit=1, device="cpu", threads=1, node="node",
                                   overlap=8, boundary_threshold=0.5, interior_threshold=0.35)
            probability = np.zeros((3, 64, 96), dtype=np.float32)

            def mutate(*unused):
                Image.new("RGB", (96, 64), "white").save(root / "page.png")
                return probability

            with patch("context_evaluate.load_context_model", return_value=(None, context_info)), \
                    patch("context_evaluate.load_model", return_value=(None, pilot_info)), \
                    patch("context_evaluate.geometry_runtime", return_value={}), \
                    patch("context_evaluate.context_probabilities", return_value=(probability, probability[0])), \
                    patch("context_evaluate.stitched_probabilities", side_effect=mutate), \
                    patch("context_evaluate.subprocess.run") as geometry:
                with self.assertRaisesRegex(RuntimeError, "Frozen input changed"):
                    run_context_evaluation(args)
                geometry.assert_not_called()
            self.assertFalse((args.output / "report.json").exists())


if __name__ == "__main__":
    unittest.main()
