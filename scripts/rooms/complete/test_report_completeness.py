import unittest

from report_completeness import completeness_metrics, derive_report


def case(expected=2, tp=2, extra=0, status="ok"):
    metrics = {"expected": expected, "predicted": tp + extra}
    for suffix in ("50", "75"):
        metrics.update({"tp" + suffix: tp, "fp" + suffix: extra, "fn" + suffix: expected - tp})
    return {"status": status, "metrics": metrics}


class CompletenessTests(unittest.TestCase):
    def test_zero_misses_is_distinct_from_zero_misses_and_extras(self):
        result = completeness_metrics([case(), case(extra=1), case(tp=1)])
        self.assertEqual(result["evaluated_nonempty_floors"], 3)
        self.assertEqual(result["thresholds"]["50"]["fraction_with_zero_missed_spaces"], 2 / 3)
        self.assertEqual(result["thresholds"]["75"]["fraction_with_zero_missed_or_extra_spaces"], 1 / 3)

    def test_failures_do_not_count_as_perfect_and_partial_reviews_are_unknown(self):
        result = completeness_metrics([case(status="error"), {"metrics": None, "status": "ok"}])
        self.assertEqual(result["failed_nonempty_floors"], 1)
        self.assertEqual(result["partial_floors_skipped"], 1)
        self.assertEqual(result["thresholds"]["50"]["fraction_with_zero_missed_spaces"], 0)

    def test_empty_or_partial_only_reference_cannot_claim_every_room_success(self):
        result = completeness_metrics([case(expected=0, tp=0), {"metrics": None}])
        self.assertEqual(result["empty_reference_floors"], 1)
        self.assertIsNone(result["thresholds"]["50"]["fraction_with_zero_missed_spaces"])

    def test_inconsistent_counts_are_rejected(self):
        row = case()
        row["metrics"]["fn75"] = 3
        with self.assertRaises(ValueError):
            completeness_metrics([row])

    def test_comparisons_remain_linked_to_original_report(self):
        result = derive_report({"results": {"model": {"cases": [case()]},
                                           "geometry": {"cases": [case(tp=1)]}}}, "frozen-hash")
        self.assertEqual(result["source_report_sha256"], "frozen-hash")
        self.assertEqual(result["results"]["geometry"]["thresholds"]["50"]["floors_with_zero_missed_spaces"], 0)


if __name__ == "__main__":
    unittest.main()
