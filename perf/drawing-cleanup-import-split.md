# Keep drawing computation out of global account cleanup

Status: implemented on current source; 25 focused tests in five files pass with
one worker, and scoped ESLint is clean. No production build, deploy or new gzip
result was produced. The press-feedback experiment is unchanged and is not part
of this slice.

Plan §9 sets 120 KB gzip shared and 60 KB additional per screen; §2 gives the
180 KB heaviest-screen target. Existing canonical R8's formal shared union is
485,725 bytes. [Existing canonical attribution](artifacts/drawing-cleanup-import-baseline-2026-11-11.json)
shows an avoidable initial dependency, present in both R7 and R8:

`DrawingAccountProvider → pdf-client.clearPdfDocuments → drawing-geometry-client
→ pipe-run-sizes → pipe-system`.

The global PDF cleanup needed only the synchronous worker registry. In existing
stats, geometry-client is 7,597 pre-minify estimated bytes, pipe-run-sizes 12,040
and pipe-system 39,588. The emitted pipe computation chunk is exactly 9,652 gzip
bytes and is required by the root/jobs-layout entry dependency closure. The
6,093-byte PDF/geometry facade chunk also contains needed PDF functionality;
its full size is not a removable-byte claim. Module estimates are not additive
gzip attribution.

The small change extracts that registry unchanged into dependency-free
`drawing-worker-lifecycle.ts`. The geometry module preserves its old exports;
worker constructors use the same registration/unregistration functions. Global
PDF cleanup and registry-only export/raster callers import the light module.
Account cleanup still synchronously disposes active workers and delayed fallback
leases before returning. No worker implementation, request protocol, drawing
algorithm, auth, snapshot storage or queue changes. This is separate from the
earlier lazy fallback split: this removes its remaining eager facade/pipe-size
import from global cleanup.

Tests verify one shared registry across old and new API paths, global PDF clear
terminating an actual pending geometry client, unregister/dispose ordering,
existing worker/fallback/export cancellation cases, and static runtime import
closure for the global account provider plus PDF/export/raster clients. The
import test ignores type-only and dynamic imports and detects the old pipe
dependency when the former edge is restored in memory. It does not estimate
compressed savings.

Next build proof must retain the unchanged formal byte metrics and independently
compare root/layout entry dependencies and emitted chunks. Other consumers or
chunk placement may retain some bytes; neither the whole 9,652 bytes nor a
specific new shared total is promised without that build. Existing saved cache,
same-account/offline behavior and account fences remain required. No phone work
or activation is involved.
