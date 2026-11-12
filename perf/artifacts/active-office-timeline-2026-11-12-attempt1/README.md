# Office material-list supplemental timeline — ten operations

One authorized attempt completed10/10 with identical active source9aae/34f and retainedfxHxrn/wTBA, original f9 visited preparation/default adapter. No CPU profiler, CDP trace, force click, DOM observer, subset rerun or gate change. All guards and final cleanup passed. This is instrumented diagnostic evidence only.

| Operation | Adapter ms | Click API ms | Visible assertion API ms | Final two-rAF evaluate API ms | App mark ms |
|---|---:|---:|---:|---:|---:|
| block1-run1 | 245.547 | 71.349 | 157.400 | 15.805 | 165.200 |
| block1-run2 | 224.679 | 38.098 | 150.712 | 34.648 | 157.500 |
| block1-run3 | 234.307 | 41.293 | 161.498 | 30.788 | 169.600 |
| block1-run4 | 209.641 | 38.339 | 155.078 | 14.237 | 163.400 |
| block1-run5 | 227.891 | 36.918 | 153.267 | 36.658 | 161.400 |
| block2-run1 | 226.016 | 39.837 | 150.701 | 34.568 | 156.800 |
| block2-run2 | 226.822 | 41.770 | 150.238 | 33.637 | 157.600 |
| block2-run3 | 244.669 | 50.443 | 158.609 | 34.869 | 171.700 |
| block2-run4 | 212.553 | 36.473 | 158.707 | 16.414 | 167.300 |
| block2-run5 | 225.353 | 40.692 | 149.940 | 33.618 | 158.800 |

Observed phase medians: adapter226.419ms, click40.265ms, visibility assertion154.172ms, final two-rAF evaluate33.627ms, browser appmark162.400ms. Click intervals ranged36.473–71.349ms and original final two-rAF evaluation14.237–36.658ms. API logs place visible/enabled/stable waits before trusted input; one click needed a second actionability wait. These are API spans including messaging/scheduling, not isolated JavaScript, frame cost or physical paint.

The capture identifies distinct variable automation and extra-frame phases in this run. It does not retrospectively explain the earlier first/repeat failure, identify an application component cause, or justify subtracting any interval from the frozen gate. App mark and outer interval still have different endpoints. Both old failed repeat and all earlier candidate rejections remain unchanged.

Each operation recorded exactly one current trusted pointerdown/click and relevant app measure, separately labelled preparation measures, bounded EventTiming/LongTask records and original API call clocks. Node before/after brackets retain mapping uncertainty. The trace.network file was empty in every operation, confirmed first by the separately authorized no-app fixture. Raw ZIPs were removed; only strict projected phase metadata remains. No headers, request bodies, query strings or raw API params/results were archived.

Four timed-window request starts were observed in each operation: three redacted /other GETs and push.identity GET. No material/catalogue pull/push started inside the recorded action windows; this does not exclude an earlier request/IndexedDB work overlapping the action. Redaction intentionally prevents further attribution of /other GETs. Captured tRPC responses had200/no error labels; cancelled/unknown inspections would remain explicit, never a success certificate. Request overlap alone is not cause.

## Bounded next step — proposal only

Before any new release comparison, specify a distinct versioned browser-local input-to-ready measure: start from the current trusted pointerdown, finish only after the exact destination and first exact Increase control are actually visible, then the same declared two-rAF paint opportunity. A narrowly scoped latch must remain pending on a hidden/missing control and validate source-negative/destination-positive conditions; do not substitute the current pathname-only appmark. Retain default-click outer/actionability/assertion spans as companion diagnostics, not silently discard them.

This requires explicit protocol review, no-app readiness/clock tests, a new complete source-bound baseline pair and prospective unchanged-code calibration under the new protocol. Preserve all prior raw records/protocol IDs; prohibit cross-protocol comparisons. Keep original10% repeatability/regression and product target budgets unchanged. No old failure becomes a pass and no new acceptance evidence exists until fresh complete measurements pass. No implementation or further run is authorized by this document.
