# Rust geometry acceleration — 2026-10-17

Three production call paths now have Rust kernels with the original TypeScript implementations retained.

- Drawing worker: longest-first collinear snap-guide preparation. Coordinates remain f64; the existing snap index and interactive nearest-point selection remain TypeScript. The Rust grouping preserves source-line support, neighbour-bucket lookup, tolerance, stable ordering and the 4,000-guide limit. This does not replace PDF.js or the pipe-system classification rules.
- Model worker: indexed mesh compaction, retaining every triangle, exact Float32 position bits, distinct hard-edge normals, signed zero and existing Int16 normal quantization. web-ifc still reads IFC. Three.js still renders and performs exact picking. Rust does not replace those compiled parsers/renderers.
- Server tagged-room detection: four-connected free-space component labels used by the outdoor-space mask, including identical row-major IDs, sizes and border flags. Native morphology remains compatible. Room rules, polygonization, annotations and reviewed results are untouched. Other synchronous hybrid detector helpers retain TypeScript.

## Measurement

Synthetic warmed medians, seven recorded runs after two warm-ups on this development machine. Wrapper packing, Wasm copies, native subprocess startup and result decoding are included. These are kernel measurements, not complete application load times or physical iPad results.

| Workload | TypeScript | Rust |
| --- | ---: | ---: |
| Chromium: 80,000 drawing dashes | 15.8 ms | 7.3 ms |
| Chromium: 300,000 model vertices | 24.2 ms | 20.9 ms |
| Node: 512 × 512 room mask | 50.9 ms | 6.8 ms |
| Node: 2048 × 2048 room mask | 755.3 ms | 39.0 ms |

Model gains are modest; no claim of a multiple-fold whole-model speedup. The browser module is approximately 64 KB; local browser fetch/initialization measured 2.7 ms. Real network latency varies. Browser fixture/receipt: `.tmp/rust-kernels/browser.mjs`, `browser-results.jsonl`. Native/Node reproduction: `pnpm exec tsx scripts/benchmark-geometry-kernels.ts`.

## Bounds and fallback

The browser module is loaded once per worker with a five-second network timeout. Unsupported/failed initialization and kernel exceptions retain TypeScript. Snap batches below 1,000 lines and meshes below 3,000 indices stay in TypeScript. Browser model acceleration caps each call at 6,000,000 float values and 3,000,000 indices to limit additional Wasm memory. Larger parts use the original path. No main-thread worker round trips were added to pointer movement.

The native room subprocess accepts only binary masks, dimensions up to 8192 per axis and 25 million pixels; CPU, address-space, response-size and wall-clock limits apply. Only one component child runs at a time; concurrent automatic requests use TypeScript. `FOREMAN_RASTER_ENGINE=typescript` disables native room paths. Native output is buffered. No network, user identifiers or filenames enter its protocol.

Rust uses `forbid(unsafe_code)`. Host Math.hypot is used in browser kernels to match JavaScript source-line tie ordering and normal rounding. Differential tests cover rotated/reversed dashes, close parallel lines, multiple sheet aspects, exact vertex bits/normals/indices, hard seams, signed zero, 16/32-bit index boundaries, malformed geometry, all-free/all-wall/checkerboard masks, border flags, loading and fallback. Tests verify computational parity, not semantic room-detection accuracy.

## Rebuild

Install Rust's `wasm32-unknown-unknown` target and `wasm-bindgen-cli` 0.2.104. Run `bash scripts/build-geometry-wasm.sh`; the pinned Cargo.lock and generated browser JS/declarations/Wasm are checked in. Run `cargo build --locked --release --manifest-path native/room-raster/Cargo.toml` for the server child. Normal Next builds use the checked-in browser artifacts and do not require a Rust toolchain. Hosts without the server binary retain TypeScript.

Validation: 63 focused Vitest checks, six existing native-process reliability tests and two Rust protocol tests pass. Scoped ESLint, TypeScript, the production build and a real Chromium module/worker smoke test pass. Native reliability tests include forced process failure, malformed/oversized replies, bounded concurrency and termination on timeout. No physical-device acceptance test was available.
