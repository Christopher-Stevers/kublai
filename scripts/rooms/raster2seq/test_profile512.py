import unittest
from pathlib import Path
from unittest.mock import patch
from adapter import resize_metadata, unpad_point
from profile512 import CHECKPOINT_SHA, VIEWS, safe_checkpoint512


class Profile512Tests(unittest.TestCase):
    def test_raw512_views_are_the_seven_previously_fixed_boxes(self):
        self.assertEqual(len(VIEWS), 7)
        self.assertEqual(VIEWS[-2:][0][1], [.148, .155, .244, .335])
        self.assertEqual(VIEWS[-2:][1][1], [.47, .14, .635, .285])

    def test512_inverse_preserves_non_square_pixel_center_frame(self):
        m = resize_metadata(825, 544, 512)
        self.assertEqual(m["size"], 512)
        x, y = 410, 217
        pt = [(x + .5) * m["new_width"] / 825 - .5 + m["left"], (y + .5) * m["new_height"] / 544 - .5 + m["top"]]
        result = unpad_point(pt, m, [2350, 525, 3175, 1069], [5000, 3750])
        self.assertAlmostEqual(result[0] * 5000, 2350 + x)
        self.assertAlmostEqual(result[1] * 3750, 525 + y)

    def test512_loader_pins_identity_and_rejects_new_globals_and_late_mutation(self):
        with patch("profile512.digest", return_value="incorrect"), patch("torch.load") as load:
            with self.assertRaisesRegex(ValueError, "unverified"):
                safe_checkpoint512(Path("never-opened"))
            load.assert_not_called()
        with patch("profile512.digest", return_value=CHECKPOINT_SHA), patch("torch.serialization.get_unsafe_globals_in_checkpoint", return_value=["untrusted.Payload"]), patch("torch.load") as load:
            with self.assertRaisesRegex(ValueError, "undeclared"):
                safe_checkpoint512(Path("fabricated"))
            load.assert_not_called()
        with patch("profile512.digest", side_effect=[CHECKPOINT_SHA, "changed"]), patch("torch.serialization.get_unsafe_globals_in_checkpoint", return_value=["argparse.Namespace"]), patch("torch.load", return_value={}) as load:
            with self.assertRaisesRegex(ValueError, "changed"):
                safe_checkpoint512(Path("fabricated"))
            self.assertTrue(load.call_args.kwargs["weights_only"])


if __name__ == "__main__":
    unittest.main()
