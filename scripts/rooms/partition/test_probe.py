"""Fabricated coverage/report checks; no actual-source or reference assets."""
import copy
import unittest
from unittest.mock import patch

from evaluate import aggregate, completeness_metrics, versions
from partition import FIXED, PRESETS, VERSION
from probe import verify_development_report, verify_support_sources


def fixture():
    metrics = {"expected": 1, "predicted": 1, "tp50": 1, "fp50": 0, "fn50": 0,
               "tp75": 1, "fp75": 0, "fn75": 0, "merge_candidates": 0, "split_candidates": 0, "matched_iou_sum": 1.0}
    rows = [{"id": f"page-{i}", "status": "ok", "metrics": dict(metrics), "timing": {"wall_ms": 10.0}} for i in range(20)]
    binding = {"binding_path": "/fixture/binding", "presets": PRESETS, "fixed": FIXED,
               "source_hashes": {"fixture": "sha"}, "input_hashes": {"asset": "sha"},
               "cases": [{"id": row["id"]} for row in rows], "baseline": {"fixture": "historical"}}
    report = {"binding_sha256": "bound", "binding_path": binding["binding_path"], "presets": PRESETS, "fixed": FIXED,
              "source_hashes": binding["source_hashes"], "input_hashes": binding["input_hashes"], "runtime": versions(),
              "version": VERSION, "results": {name: {"cases": copy.deepcopy(rows), "summary": aggregate(rows),
                                                      "completeness": completeness_metrics(rows)} for name in PRESETS}}
    report["results"]["historical_normal_barrier_04"] = binding["baseline"]
    return binding, report


class ProbeTests(unittest.TestCase):
    def test_support_adapter_drift_is_rejected_instead_of_relabeling_loaded_code(self):
        with patch("probe.sources", return_value={"probe.py": "changed"}):
            with self.assertRaisesRegex(RuntimeError, "source changed"):
                verify_support_sources({"probe.py": "loaded"})

    def test_unique_full_case_coverage_required_for_every_method(self):
        binding, report = fixture()
        verify_development_report(report, binding, "bound")
        report["results"]["hierarchical_basins"]["cases"][-1]["id"] = "page-0"
        with self.assertRaisesRegex(ValueError, "unique original"):
            verify_development_report(report, binding, "bound")

    def test_mutated_source_runtime_or_aggregate_cannot_change_ranking(self):
        for key in ("source_hashes", "runtime"):
            binding, report = fixture()
            report[key] = {"wrong": "value"}
            with self.assertRaisesRegex(ValueError, "exact completed"):
                verify_development_report(report, binding, "bound")
        binding, report = fixture()
        report["results"]["weighted_basins"]["summary"]["fn50"] = 19
        with self.assertRaisesRegex(ValueError, "summary disagrees"):
            verify_development_report(report, binding, "bound")


if __name__ == "__main__":
    unittest.main()
