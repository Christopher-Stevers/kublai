# Rust wall-processing pilot — 2026-10-11 UTC

Tim authorized a measured Rust pilot for room geometry. This implementation
accelerates two active tagged-detector wall-preparation stages rather than
replacing React, Next.js, authentication, chat, database APIs or JSTS topology.
The implementation preserves the existing algorithm and keeps its TypeScript
fallback. No stored rooms or reviewed geometry were modified for evaluation.

## Results

Local sequential runs used Node 26.8.2 and a release build with Rust 1.99.0.
Three existing development plan renders were used; private source images remain
in ignored local storage. This evaluation measures identical computation, not
physical-room or suite accuracy. No protected holdout was evaluated.

| Input | Pixels | TypeScript median | Rust median | Ratio |
| --- | ---: | ---: | ---: | ---: |
| Render A | 20,155,392 | 2,474.6 ms | 613.4 ms | 4.03× |
| Render B | 20,155,392 | 2,443.4 ms | 608.3 ms | 4.02× |
| Render C | 3,257,550 | 387.2 ms | 101.1 ms | 3.83× |

Each row has five measured iterations after one warm-up. The workload is close
followed by open, using the current drawing-scale-derived radii. Rust timing
includes startup, IPC and response parsing. Every output hash matched exactly.
Renders A/B are slightly larger than the current 5000-long-side detector render.

The surrounding wall-preparation pipeline (outdoor-region selection, masking and
double-wall preparation) on render A dropped from a median 8,254.0 ms to
4,577.0 ms, approximately 44.5% less time. Both complete image bytes and outdoor
statistics matched. This uses three measured iterations after warm-up and fixed
seeds, so it does not establish naming or detection quality.

One actual source-PDF page was also passed through the entire tagged detector.
Both runs produced ten room proposals and the same complete result hash, including
outlines, names and statistics. Elapsed time was 24,741.9 ms with TypeScript and
20,891.9 ms with Rust. This single end-to-end pair is a correctness check and
illustrative timing, not a production latency percentile or general speed claim.
The comparison used no database reads/writes or annotation approvals.

The native child peaked at 41,152 KiB RSS on render A, below its 192 MiB address
space cap. Overall memory did not improve in the sampled PDF runs: Node's peak
RSS rose from 1,121,932 KiB to 1,149,276 KiB, with additional native-child memory
during the filtering stages. These are process peaks, not a simultaneous total;
GC timing and image copies also affect them. The pilot trades a small additional
memory cost for reduced CPU time and preserves the existing 4 GiB detector cgroup.

## Validation and scope

- 168 deterministic native/TypeScript comparisons cover both operations, composed
  passes, degenerate image dimensions, block boundaries and radii beyond image size.
- Input immutability, dimension/radius validation, truncated and nonbinary input,
  malformed and oversized output, missing-binary fallback, concurrent admission,
  engine disablement and timeout termination are covered by six Node tests.
- A separate integrated synthetic-image check preserves every wall pixel and
  outdoor-region statistic against a frozen copy of the original helpers.
- Eighteen existing tagged/topology/hatch tests passed. TypeScript and changed-file
  lint passed; Rust unit tests, Clippy and release build passed.

The Rust crate forbids unsafe code and has no external dependencies. It adds
bounded CPU processing; it does not establish stronger app authentication,
authorization, tenant isolation or upload safety. The component uses no network
and does not send customer drawings to a provider. Resource limits do not constitute
a general OS sandbox. Smaller masks and unsupported hosts retain TypeScript.

Detailed receipts, input/output hashes, frozen source, benchmark logs and rollout
record are in `.tmp/rust-raster-pilot/`. Reproduction commands and operational
limits are in `native/room-raster/README.md`.
