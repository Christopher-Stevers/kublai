# Room raster worker

This small Rust component runs the existing binary-mask erosion/dilation filters
used to prepare walls for tagged room detection. It preserves the TypeScript
van Herk/Gil-Werman algorithm, padding and pass order. It does not change room
classification, thresholds, labels, polygonization or annotations.

The existing isolated detection process calls `rasterMorphology` over stdin/stdout.
The worker has no network code or filesystem access in its application code, no
external crates and `#![forbid(unsafe_code)]`. Linux `prlimit` bounds each child's
address space to 192 MiB and CPU to 10 seconds soft / 11 seconds hard. Node kills
it after 15 seconds and caps output length. The child also inherits the detector's
existing cgroup. These are resource limits, not a general syscall sandbox.

Requests are limited to 25 million binary pixels, 8192 pixels per edge,
16 operations and a maximum radius of 256. Validation happens before image
allocation. One native request runs at a time per Node process. Requests below
262,144 pixels use the original TypeScript code. Missing binaries, unsupported
hosts, busy workers, timeouts and invalid responses fall back to TypeScript.
No detector rules change during fallback. Logs contain engine, pixel count,
operation count and duration; no drawing bytes, room names or customer IDs.

## Build and verify

From the repository root, using Rust 1.85 or later (validated with 1.99.0):

```sh
cargo build --release --manifest-path native/room-raster/Cargo.toml
cargo test --manifest-path native/room-raster/Cargo.toml
cargo clippy --all-targets --manifest-path native/room-raster/Cargo.toml -- -D warnings
node --import tsx --test src/server/rooms/raster-native.node-test.ts
```

The executable must be at `native/room-raster/target/release/foreman-room-raster`
relative to the detection worker's repository working directory. Build it for
the deployment host's architecture. Build output is ignored by Git; ship the
verified executable alongside source when deploying. This local pilot does not
install a native component into a remote Cloudflare Workers runtime.

Automatic selection is the default. Set `FOREMAN_RASTER_ENGINE=typescript` in the
detector's environment to disable native processing. No service restart is needed
for new CLI detection jobs to use updated worker source/binary. Already-running
detections must finish before replacing source or the executable; use the queue's
existing admission lock to make that transition consistent.

## Measure

```sh
node --import tsx scripts/benchmark-room-raster.ts typescript /private/plan.png /private/ts.json 5
node --import tsx scripts/benchmark-room-raster.ts rust /private/plan.png /private/rust.json 5
node --import tsx scripts/benchmark-room-wall-preparation.ts typescript /private/plan.png /private/walls-ts.json 3
node --import tsx scripts/benchmark-room-wall-preparation.ts rust /private/plan.png /private/walls-rust.json 3
node --import tsx scripts/verify-room-raster-pdf.ts typescript /private/plan.pdf /private/pdf-ts.json 1
node --import tsx scripts/verify-room-raster-pdf.ts rust /private/plan.pdf /private/pdf-rust.json 1
```

Run timing comparisons sequentially on the same machine and compare output
hashes. The first timing iteration is warm-up. Kernel measurements include
process startup, pipe transfer, computation and output parsing; image decoding
and input thresholding are excluded. Wall-preparation measurements also include
outdoor-region selection and painting. The PDF command runs the pure detector,
without database writes. Fixed-seed image benchmarks measure implementation
equivalence, not room-detection accuracy. Protected holdout datasets are not used.

Measured pilot results and limitations are in
`docs/RUST_RASTER_PILOT_2026-10-11.md`.
