import ast
from pathlib import Path
import unittest

import numpy as np
from PIL import Image
import torch

from adapter import CASES, model_pixel_to_page, page_to_model_pixel, preprocess, split_heads, unpad


class RasterAdapterTest(unittest.TestCase):
    def test_exact_training_range_and_neutral_padding(self):
        pixels = np.array([[[0, 127, 255], [255, 0, 127]]], dtype=np.uint8)
        tensor, _, transform = preprocess(Image.fromarray(pixels))
        content = unpad(tensor[0].numpy(), transform)
        np.testing.assert_allclose(content, np.moveaxis(pixels.astype(np.float32), -1, 0) * (2 / 255) - 1)
        self.assertEqual(tensor[0, 0, 0, 0], 0)
        self.assertEqual(transform["canvas_size"], [256, 256])

    def test_no_empty_unpad_on_square_zero_padding(self):
        tensor, _, transform = preprocess(Image.new("RGB", (256, 256), "white"))
        self.assertEqual(unpad(tensor[0], transform).shape, (3, 256, 256))
        self.assertTrue(torch.all(unpad(tensor[0], transform) == 1))

    def test_odd_padding_and_bound_do_not_stretch(self):
        tensor, _, transform = preprocess(Image.new("RGB", (2001, 1001), "white"))
        self.assertEqual(tensor.shape, (1, 3, 1024, 1024))
        self.assertEqual(transform["resized_size"], [1024, 512])
        self.assertEqual(unpad(tensor[0], transform).shape, (3, 512, 1024))
        _, _, odd = preprocess(Image.new("RGB", (255, 128)))
        self.assertEqual(odd["left"], 0)
        self.assertEqual(odd["canvas_size"], [256, 256])

    def test_source_mapping_round_trips_centers_and_content_edges(self):
        _, _, transform = preprocess(Image.new("RGB", (2001, 1001)))
        box, page = [50, 70, 2051, 1071], [4000, 2000]
        for x, y in [(0, 256), (1023, 767), (20.25, 600.75), (-.5, 255.5)]:
            full = model_pixel_to_page(x, y, transform, box, page)
            back = page_to_model_pixel(*full, transform, box, page)
            np.testing.assert_allclose(back, [x, y], rtol=0, atol=1e-10)
        np.testing.assert_allclose(model_pixel_to_page(-.5, 255.5, transform, box, page), [.0125, .035])

    def test_official_head_offsets_and_no_extra_sigmoid(self):
        outputs = torch.arange(44, dtype=torch.float32)[None, :, None, None]
        heat, rooms, icons = split_heads(outputs)
        self.assertEqual(heat[20, 0, 0], 20)
        self.assertEqual(rooms[2, 0, 0], 23)  # Wall
        self.assertEqual(icons[1, 0, 0], 34)  # Window
        self.assertEqual(icons[2, 0, 0], 35)  # Door
        with self.assertRaises(ValueError):
            split_heads(torch.zeros(1, 51, 1, 1))
        outputs[0, 0, 0, 0] = float("nan")
        with self.assertRaises(ValueError):
            split_heads(outputs)

    def test_fixed_views_equal_frozen_raster2seq_baseline(self):
        trial = Path(__file__).parents[1] / "raster2seq" / "trial.py"
        tree = ast.parse(trial.read_text())
        cases = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
                     and any(isinstance(t, ast.Name) and t.id == "CASES" for t in n.targets))
        self.assertEqual(CASES, cases)


if __name__ == "__main__":
    unittest.main()
