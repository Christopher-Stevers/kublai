import unittest
import numpy as np
import torch
from evaluate_heads import coverage, head_counts, summarize
from network import supervised_loss


class HeadTests(unittest.TestCase):
    def test_unknown_target_or_prediction_does_not_change_counts(self):
        p = np.zeros((3, 4, 4), np.float32); t = np.zeros_like(p, np.uint8); k = np.ones_like(t)
        k[:, 1, :] = 0; t[:, 2, 2] = 1; p[:, 2, 2] = .8
        original = head_counts(p, t, k)
        p[:, 1, :] = 1; t[:, 1, :] = 1
        self.assertEqual(original, head_counts(p, t, k))
        for counts in original.values():
            self.assertEqual(counts, dict(tp=1, fp=0, fn=0, tn=11, known=12, unknown=4))

    def test_aggregate_only_pixel_metrics_and_empty_denominators(self):
        p = np.zeros((3, 2, 2), np.float32); t = np.zeros_like(p, np.uint8); k = np.zeros_like(t)
        result = summarize([{"heads": head_counts(p, t, k)}])
        for head in result.values():
            self.assertIsNone(head["pixel_iou"]); self.assertIsNone(head["pixel_recall"])
            self.assertEqual(head["unknown"], 4)
        self.assertFalse(any("room" in key or "floor" in key for key in result))

    def test_malformed_predictions_and_duplicate_coverage_fail(self):
        p = np.zeros((3, 2, 2), np.float32); p[1,0,0] = np.nan
        with self.assertRaises(ValueError): head_counts(p, np.zeros_like(p), np.ones_like(p))
        for rows in ([{"id":"a"},{"id":"a"}], [{"id":"a"}]):
            with self.assertRaises(ValueError): coverage(rows, ["a","b"])
        coverage([{"id":"b"},{"id":"a"}], ["a","b"])

    def test_unchanged_loss_masks_unknown_positives_and_zero_gradient(self):
        logits = torch.zeros((1,3,4,4), requires_grad=True)
        target = torch.zeros_like(logits); known = torch.ones_like(logits); known[:,:,1,:] = 0
        first = supervised_loss(logits, target, known)
        target[:,:,1,:] = 1
        second = supervised_loss(logits, target, known)
        self.assertEqual(float(first.detach()), float(second.detach()))
        second.backward(); self.assertTrue(torch.equal(logits.grad[:,:,1,:], torch.zeros_like(logits.grad[:,:,1,:])))
        loss = supervised_loss(logits, torch.ones_like(logits), torch.zeros_like(logits))
        self.assertEqual(float(loss.detach()), 0)


if __name__ == "__main__": unittest.main()
