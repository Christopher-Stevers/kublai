import unittest

import numpy as np
from PIL import Image, ImageDraw

from hybrid_native import arc_and_leaf, monochrome_ink, native_probabilities, supported_portals


class NativeHybridTests(unittest.TestCase):
    def test_red_revision_markup_is_withheld_but_gray_wall_ink_is_retained(self):
        image = np.ones((32, 32, 3), dtype=np.float32)
        image[10, 3:20] = (0.7, 0.1, 0.1)
        image[20, 3:20] = (0.7, 0.7, 0.7)
        ink = monochrome_ink(image)
        self.assertFalse(np.any(ink[10]))
        self.assertEqual(int(ink[20].sum()), 17)

    def test_portal_closure_requires_connected_leaf_and_quarter_swing(self):
        drawing = Image.new("L", (100, 100), 0)
        draw = ImageDraw.Draw(drawing)
        draw.line((30, 50, 30, 80), fill=1, width=1)
        draw.arc((0, 20, 60, 80), 0, 90, fill=1, width=1)
        ink = np.asarray(drawing)
        self.assertTrue(arc_and_leaf(ink, 30, 60, 50))
        self.assertFalse(arc_and_leaf(np.zeros_like(ink), 30, 60, 50))
        # A disconnected ornamental circle does not have the hinge leaf.
        circle = Image.new("L", (100, 100), 0)
        ImageDraw.Draw(circle).ellipse((40, 40, 70, 70), outline=1)
        self.assertFalse(arc_and_leaf(np.asarray(circle), 30, 60, 50))

    def test_plain_opening_is_not_closed_without_door_evidence(self):
        walls = np.zeros((80, 120), dtype=np.uint8)
        walls[40, 5:45] = 1; walls[40, 66:115] = 1
        closures, accepted = supported_portals(walls, walls, 30)
        self.assertEqual(accepted, 0)
        self.assertFalse(np.any(closures))

    def test_disconnected_sampled_dots_do_not_prove_a_connected_door(self):
        ink = np.zeros((100, 100), dtype=np.uint8)
        angles = np.linspace(0.08, np.pi / 2 - 0.08, 18)
        fractions = np.linspace(0.15, 0.95, 12)
        xs, ys = np.rint(30 + 30 * np.cos(angles)).astype(int), np.rint(50 + 30 * np.sin(angles)).astype(int)
        ink[ys, xs] = 1
        ink[np.rint(50 + 30 * fractions).astype(int), 30] = 1
        self.assertFalse(arc_and_leaf(ink, 30, 60, 50))

    def test_connected_double_swings_span_the_entire_opening(self):
        drawing = Image.new("L", (120, 120), 0)
        draw = ImageDraw.Draw(drawing)
        draw.line((30, 50, 30, 70), fill=1); draw.line((70, 50, 70, 70), fill=1)
        draw.arc((10, 30, 50, 70), 0, 90, fill=1)
        draw.arc((50, 30, 90, 70), 90, 180, fill=1)
        ink = np.asarray(drawing)
        self.assertTrue(arc_and_leaf(ink, 30, 70, 50))
        self.assertFalse(arc_and_leaf(ink, 30, 90, 50))

    def test_vertical_portal_uses_the_same_transposed_door_proof(self):
        drawing = Image.new("L", (1024, 1024), 0)
        draw = ImageDraw.Draw(drawing)
        draw.line((300, 300, 300, 312), fill=1)
        draw.arc((288, 288, 312, 312), 0, 90, fill=1)
        draw.line((100, 300, 299, 300), fill=1); draw.line((313, 300, 500, 300), fill=1)
        ink = np.asarray(drawing)
        image = np.repeat((1 - ink[:, :, None]).astype(np.float32), 3, axis=2)
        probability = np.zeros((3, 1024, 1024), dtype=np.float32)
        probability[0] = 0.9
        probability[1, 300, 100:501] = 0.2
        horizontal, hd = native_probabilities(image, probability, "portal_wide")
        vertical, vd = native_probabilities(image.transpose(1, 0, 2).copy(), probability.transpose(0, 2, 1).copy(), "portal_wide")
        self.assertGreater(hd["accepted_horizontal_portals"], 0)
        self.assertGreater(vd["accepted_vertical_portals"], 0)
        self.assertTrue(np.array_equal(horizontal, vertical.transpose(0, 2, 1)))

    def test_native_wall_faces_supplement_weak_gray_boundary_and_keep_learned_color(self):
        image = np.ones((256, 256, 3), dtype=np.float32)
        image[60, 30:220] = 0.7; image[64, 30:220] = 0.7
        probabilities = np.zeros((3, 256, 256), dtype=np.float32)
        probabilities[0, 30:220, 20:230] = 0.9
        probabilities[1, 62, 30:220] = 0.2
        probabilities[1, 180, 40:210] = 0.9
        result, _ = native_probabilities(image, probabilities, "native_walls")
        self.assertGreater(float(result[1, 60, 100]), 0.9)
        self.assertEqual(float(result[1, 180, 100]), float(probabilities[1, 180, 100]))
        self.assertTrue(np.array_equal(result[0], probabilities[0]))


if __name__ == "__main__":
    unittest.main()
