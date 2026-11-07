import unittest

import numpy as np

from compose import MAX_PIXELS, compose_probability


class ComposeTests(unittest.TestCase):
    def test_selected_heads_preserve_bits_and_inputs_without_aliasing(self):
        old = np.linspace(0, 1, 36, dtype=np.float32).reshape(3, 3, 4)
        new = np.flip(old, axis=2).copy()
        old[0, 0, 0] = np.float32(-0.0)
        new[2, 0, 0] = np.float32(-0.0)
        before = old.tobytes(), new.tobytes()
        result = compose_probability(old, new)
        self.assertEqual(result[0].tobytes(), old[0].tobytes())
        self.assertEqual(result[1:].tobytes(), new[1:].tobytes())
        self.assertEqual(before, (old.tobytes(), new.tobytes()))
        self.assertFalse(np.shares_memory(result, old))
        self.assertFalse(np.shares_memory(result, new))
        result[:] = 0
        self.assertEqual(before, (old.tobytes(), new.tobytes()))

    def test_strided_inputs_keep_native_pixel_order(self):
        old = np.linspace(0, 1, 60, dtype=np.float32).reshape(3, 4, 5)[:, ::-1, ::-1]
        new = np.asfortranarray(1 - old)
        result = compose_probability(old, new)
        self.assertTrue(result.flags.c_contiguous)
        self.assertEqual(result[0].tobytes(), old[0].tobytes())
        self.assertEqual(result[1:].tobytes(), new[1:].tobytes())

    def test_mismatched_grids_channels_empty_and_dtype_fail(self):
        valid = np.zeros((3, 2, 2), dtype=np.float32)
        invalid = [np.zeros((3, 2, 3), dtype=np.float32),
                   np.zeros((2, 2, 2), dtype=np.float32),
                   np.zeros((3, 0, 2), dtype=np.float32),
                   np.zeros((3, 2, 2, 1), dtype=np.float32),
                   valid.astype(np.float64), valid.tolist()]
        for value in invalid:
            with self.subTest(shape=getattr(value, "shape", None)):
                with self.assertRaises(ValueError):
                    compose_probability(valid, value)

    def test_bad_probabilities_fail_even_in_unselected_heads(self):
        valid = np.zeros((3, 2, 2), dtype=np.float32)
        for bad in (np.nan, np.inf, -np.inf, -.01, 1.01):
            for head in range(3):
                value = valid.copy()
                value[head, 0, 0] = bad
                with self.subTest(bad=bad, head=head):
                    with self.assertRaises(ValueError):
                        compose_probability(valid, value)
                    with self.assertRaises(ValueError):
                        compose_probability(value, valid)

    def test_page_budget_is_checked_before_reading_virtual_pixels(self):
        oversized = np.broadcast_to(np.zeros(1, dtype=np.float32), (3, 1, MAX_PIXELS + 1))
        with self.assertRaisesRegex(ValueError, "budget"):
            compose_probability(oversized, oversized)


if __name__ == "__main__":
    unittest.main()
