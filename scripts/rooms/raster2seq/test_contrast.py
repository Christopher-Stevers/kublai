import unittest
from PIL import Image
from contrast_trial import DECLARED_CASES, GAMMA3_LUT, LOCAL_CASES, transform_input


class ContrastTests(unittest.TestCase):
    def test_exact_monotonic_declared_gamma_preserves_black_white(self):
        self.assertEqual(GAMMA3_LUT, [round(v ** 3 / 255 ** 2) for v in range(256)])
        self.assertEqual((GAMMA3_LUT[0], GAMMA3_LUT[255]), (0, 255))
        self.assertEqual(GAMMA3_LUT, sorted(GAMMA3_LUT))
        self.assertLess(GAMMA3_LUT[220], 220)

    def test_gray_input_is_transformed_before_resize_without_mutation(self):
        source = Image.new("RGB", (3, 1))
        source.putdata([(0, 0, 0), (220, 220, 220), (255, 255, 255)])
        before = source.tobytes()
        transformed = transform_input(source, "gamma3")
        self.assertEqual(list(transformed.getdata()), [(0, 0, 0), (GAMMA3_LUT[220],) * 3, (255, 255, 255)])
        self.assertEqual(source.tobytes(), before)
        self.assertEqual(transform_input(source, "raw").tobytes(), before)
        with self.assertRaises(ValueError):
            transform_input(source, "adaptive")

    def test_fixed_cases_include_only_five_contrast_and_two_paired_local_views(self):
        self.assertEqual(len(DECLARED_CASES), 9)
        self.assertEqual(len(set(x[0] for x in DECLARED_CASES)), 9)
        for name, box in LOCAL_CASES:
            self.assertEqual([(b, mode) for n, b, mode in DECLARED_CASES if n.startswith(name)], [(box, "raw"), (box, "gamma3")])


if __name__ == "__main__":
    unittest.main()
