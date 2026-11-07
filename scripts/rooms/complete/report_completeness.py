"""Derive whole-floor success from a frozen, complete-reference run report.

This never reruns a detector or reads reference images. Partial reviews cannot
establish completeness and are excluded; failed runs cannot count as successes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path


def completeness_metrics(cases):
    complete = [row for row in cases if row.get("metrics") is not None]
    nonempty = []
    empty = 0
    for row in complete:
        metrics = row["metrics"]
        for key in ("expected", "predicted", "tp50", "fp50", "fn50", "tp75", "fp75", "fn75"):
            value = metrics.get(key)
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                raise ValueError(f"Invalid full-space count: {key}")
        for suffix in ("50", "75"):
            if (metrics["tp" + suffix] + metrics["fn" + suffix] != metrics["expected"] or
                    metrics["tp" + suffix] + metrics["fp" + suffix] != metrics["predicted"]):
                raise ValueError("Inconsistent room-matching counts")
        if metrics["expected"]:
            nonempty.append(row)
        else:
            empty += 1
    count = len(nonempty)
    thresholds = {}
    for suffix, threshold in (("50", 0.50), ("75", 0.75)):
        zero_miss = sum(row.get("status") == "ok" and row["metrics"]["fn" + suffix] == 0 for row in nonempty)
        exact = sum(row.get("status") == "ok" and row["metrics"]["fn" + suffix] == 0 and
                    row["metrics"]["fp" + suffix] == 0 for row in nonempty)
        thresholds[suffix] = {
            "iou_threshold": threshold,
            "floors_with_zero_missed_spaces": zero_miss,
            "fraction_with_zero_missed_spaces": zero_miss / count if count else None,
            "floors_with_zero_missed_or_extra_spaces": exact,
            "fraction_with_zero_missed_or_extra_spaces": exact / count if count else None,
        }
    return {
        "evaluated_nonempty_floors": count,
        "partial_floors_skipped": len(cases) - len(complete),
        "empty_reference_floors": empty,
        "failed_nonempty_floors": sum(row.get("status") != "ok" for row in nonempty),
        "thresholds": thresholds,
    }


def derive_report(payload, digest):
    results = payload.get("results")
    groups = results if isinstance(results, dict) else {"detector": payload}
    if not groups or any(not isinstance(group.get("cases"), list) for group in groups.values()):
        raise ValueError("A frozen report with per-floor cases is required")
    return {
        "version": 1,
        "source_report_sha256": digest,
        "results": {method: completeness_metrics(group["cases"]) for method, group in groups.items()},
        "limitations": [
            "The source report must already establish complete ground truth and source provenance.",
            "Synthetic floor success does not establish accuracy on construction sheets.",
            "Zero misses allows extra proposals; zero misses and extras requires one-to-one matches.",
            "Room matching at these IoU thresholds does not certify exact architectural boundaries.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    raw = args.report.read_bytes()
    report = derive_report(json.loads(raw), hashlib.sha256(raw).hexdigest())
    text = json.dumps(report, indent=2, allow_nan=False) + "\n"
    if args.output:
        args.output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            stream.write(text)
    else:
        print(text, end="")


if __name__ == "__main__":
    main()
