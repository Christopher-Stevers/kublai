import unittest
import numpy as np
from PIL import Image, ImageDraw
from skimage.transform import SimilarityTransform, warp
from registration import register, apply, transfer_shape


def synthetic_pair(reflected=False):
    rng = np.random.default_rng(215)
    im = Image.new('L', (300, 260), 255)
    draw = ImageDraw.Draw(im)
    draw.rectangle((14, 14, 284, 244), outline=0, width=3)
    for _ in range(34):
        x, y = rng.integers([25, 25], [260, 220])
        w, h = rng.integers(5, 23, size=2)
        if rng.integers(2): draw.rectangle((x, y, x+w, y+h), outline=0, width=2)
        else: draw.ellipse((x, y, x+w, y+h), outline=0, width=2)
    original = np.asarray(im, dtype=float)/255
    transform = SimilarityTransform(scale=.8, rotation=.17, translation=(135, 63))
    reflection = np.array([[-1, 0, 299], [0, 1, 0], [0, 0, 1]]) if reflected else np.eye(3)
    matrix = transform.params@reflection
    target = warp(original, inverse_map=np.linalg.inv(matrix), output_shape=(400, 480), order=1, cval=1)
    return original, target, matrix


class RegistrationTests(unittest.TestCase):
    def test_translated_rotated_scaled_source(self):
        source, target, truth = synthetic_pair()
        candidates, diag = register(source, target, .8)
        self.assertEqual(len(candidates), 1, diag)
        probe = np.array([[20, 20], [270, 20], [270, 230], [20, 230]])
        self.assertLess(np.max(np.linalg.norm(apply(candidates[0]['matrix_source_to_target'], probe)-apply(truth, probe), axis=1)), 2)
        self.assertEqual(candidates[0]['review_status'], 'pending')

    def test_reflection_is_explicit(self):
        source, target, truth = synthetic_pair(True)
        candidates, diag = register(source, target, .8)
        self.assertEqual(len(candidates), 1, diag)
        self.assertTrue(candidates[0]['reflected'])
        self.assertLess(np.max(abs(np.array(candidates[0]['matrix_source_to_target'])-truth)), 1.5)

    def test_printed_scale_disagreement_rejected(self):
        source, target, _ = synthetic_pair()
        result, diag = register(source, target, .4)
        self.assertEqual(result, [], diag)

    def test_blank_cannot_register(self):
        result, _ = register(np.ones((100,100)), np.ones((120,120)), 1)
        self.assertEqual(result, [])

    def test_holes_survive_mirror_transfer_without_approval(self):
        shape = {'outer': [[0,0], [20,0], [20,10], [0,10]], 'holes': [[[3,2], [5,2], [5,4], [3,4]]]}
        m = [[-2,0,70],[0,2,30],[0,0,1]]
        out = transfer_shape(shape, m)
        self.assertEqual(out['outer'][1], [30,30])
        self.assertEqual(out['holes'][0][0], [64,34])
        self.assertEqual(out['review_status'], 'pending')

    def test_nonuniform_warp_rejected(self):
        with self.assertRaises(ValueError):
            transfer_shape({'outer': [[0,0],[1,0],[1,1]]}, [[2,0,0],[0,1,0],[0,0,1]])


if __name__ == '__main__':
    unittest.main()
