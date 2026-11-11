# Tap timing definition audit

Recommendation: preserve frozen v2 and every failed gate as automation
end-to-end regression evidence. A separately named, versioned browser-input
metric is warranted for the user-facing target, after explicit calibration and
review. Do not relabel old samples, subtract estimated overhead, switch to force
clicks, change thresholds or use the new metric to waive an existing failure.

## What the existing numbers include

[Plan §2/§7](SPEED_PLAN.md) requires visited-screen tap-to-paint below 100 ms at
p95, separate same-frame pressed/write feedback, startup and drawing targets.
Frozen `25dfa8bf…` `perf/run.mjs:249` instead starts a Node clock before the
journey adapter. Its `openjob` awaits normal locator click, a destination
visibility assertion, then another browser command awaiting two rAF callbacks.
This includes automation transport/actionability and assertion scheduling as
well as genuine application work and frame alignment. Quantity/receipt journeys
also read prior values before clicking; chat includes filling text. Cold start
and sheet/pinch include broader work and must keep those semantics.

The retained [actionability diagnostic](artifacts/openjob-actionability-diagnostic-2026-11-11-assessment.json)
found request-to-pointer medians of 33.3/36.2 ms with default clicks versus
7.8/8.1 ms with force, while click-to-DOM-ready stayed 9.1–9.3 ms. That supports
a substantial shared automation/actionability contribution in this experiment,
not that default clicks are invalid or all delay is measurement overhead. R7's
pointerdown-to-click remained 4.5–4.6 ms versus baseline 1.7–2.0 ms: real work
inside that browser interval remains. Force bypasses multiple checks, not only
one stability frame. Its instrumentation changes scheduling; those medians
cannot correct the original full-matrix results.

The Phase0 `SpeedTelemetry` mark starts at pointerdown-listener
`performance.now()`, observes pathname readiness, then two rAFs. It excludes
queueing before listener receipt and misses same-URL local navigation. Newer
[`navigation-paint.ts`](../src/lib/navigation-paint.ts) adds gesture ownership,
keyboard/local commits and loading guards; it is outside the frozen R7 capture.
Neither DOM-ready nor two rAFs proves physical compositor display; two rAFs
provide an intervening paint opportunity. Field INP is another separate metric.

## Contract required for a new version

- Validate trusted event `timeStamp` clock origin/precision against the browser
  performance timeline; where available, Event Timing `startTime` and
  `processingStart` distinguish input queueing from handler work. A listener's
  `performance.now()` alone cannot retain pre-listener queue delay. None of
  these establishes hardware finger-to-photon latency.
- Predeclare the activation boundary. Fixed controls act on down; scroll rows
  and destructive/send controls act on valid release; keyboard/assistive
  activation needs its own correlated trusted-input contract. Plan §7 explicitly
  allows an 80–120 ms row hold/preparation interval. Publish down-to-ready and
  accepted-activation-to-ready separately; do not silently remove dwell to make
  the 100 ms target pass. Record scroll cancellation, never count a wrong open
  as success, and retain the 200-fling check. Readiness/actionability delay
  outside the browser-input interval remains separately reported.
- Keep journey-specific assertions: correct visible screen/data, changed write
  value/pending outcome, absent loading/skeletons and required drawing coverage.
  Immediate pressed feedback or an arbitrary next frame is not destination
  readiness. Preserve complete startup/chat-fill/pinch journey duration beside
  the new applicable input interval. Calibrate any paint-opportunity proxy
  against actual rendering observations before calling it the plan's paint.
- Keep every slow result, timeout, missing event/paint, denied/error outcome and
  denominator. Missing/unsupported instrumentation is unmeasured or failed, never
  zero. Pre-activation cancelled gestures are separately counted; accepted
  actions that never become ready cannot disappear from a fast-only percentile.

Before gating: freeze and hash the new driver/instrumentation/toolchain and
source/fixture bindings; use the same reference CPU/links and visited-state
contracts, plus explicit offline evidence for the plan's no-signal target.
Collect two independent complete baseline runs under that version and satisfy
Phase0's less-than-10% repeatability rule using predeclared statistics. The
100 ms target is p95; five-sample cell medians from the existing regression
checker do not establish it, so tail sample counts must be specified before
collection. Measure a separately source-matched candidate without filtering or
selective retries. Finally retain [§13](SPEED_PLAN.md)'s planted 30 KB/100 ms/new
poll detections **and 20 unchanged-build runs without a false alarm** before
using a recalibrated gate. Twenty samples within one diagnostic are not twenty
independent gate runs. All original v2 results remain authoritative for v2.

This audit changed no code, metric, threshold, report or release decision.
