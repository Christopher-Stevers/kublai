# Timing method and provenance

`early-pinch-v1` opens the sheet and pinches as soon as the preview is visible.
The original two full 120-sample captures are preserved byte-for-byte in
`perf/artifacts/baseline-early-pinch-v1-{1,2}-2026-11-10.json`. One Site sheet
cell differed by 47.2%; neither capture is an accepted baseline. Those captures
predate in-run harness attestation. Their original reports must not be amended
with a reconstructed driver hash.

`ready-then-pinch-v2` is a separate calibration: click open, wait for complete
sharp PDF coverage, pinch, wait for complete sharp PDF coverage. The whole
sequence remains timed. Browser stage measures separate opening readiness,
gesture duration, cached pinch through final sharpness, and gesture end through
final sharpness. Gesture end is recorded immediately after the CDP gesture
returns. Coverage is sampled every 50 ms with a paint opportunity; these are not
physical-device every-frame or same-frame measurements. The immediate-pinch
stress result remains unresolved. No comparison across these protocols is valid.

Freeze before running:

```sh
PERF_SOURCE_ROOT=/absolute/frozen/release node perf/freeze-harness.mjs
```

The returned directory contains read-only copies of 29 timing, seed, auth,
preflight and static collector inputs plus a SHA-256 file manifest. Set
`PERF_HARNESS_DIR` to that directory and run its `perf/lab/database.sh` and
`perf/pilot.sh` or `perf/full-baseline.sh`. Diagnostics must create another frozen
copy rather than edit the original. The app source and its allowed lab transforms
remain separately source-bound. Dependencies are shared; Node, Playwright and
Chromium versions are recorded and must match for comparison.

Reports carry `harnessFingerprint`, `harnessFingerprintAlgorithm`,
`harnessFileCount`, `harnessToolchain` and `harnessVerification` with matching
before/after hashes and `immutable: true`. Missing, changed, writable or unmatched
methods fail validation/comparison. Activation tests also reject mismatched
protocols and harness hashes. The frozen directory is local evidence, not a
security boundary against its owner deliberately changing permissions.

At the initial five-Site v2 calibration checkpoint, that diagnostic did not
schedule another full pair before candidate build/static review. Subsequently,
the first full v2 pair failed one material-list cell; its separate sealed rerun
now passes all 24 cell-median repeatability checks (see the uniquely named
`baseline-ready-then-pinch-v2-rerun-2026-11-11-*` artifacts). Both complete runs
retain 120 samples, source/method binding and zero database errors. Earlier
failed captures remain unchanged; no cross-protocol comparison follows.

Production-byte transport, real auth startup, controlled Pixel timing, offline
and final targets remain separate proof requirements. The fresh ten-minute
Jobs-only idle capture records 80 query reads and one open stream, not a no-poll
or all-screen pass. No candidate regression comparison or activation follows
from the accepted same-build repeatability pair.
