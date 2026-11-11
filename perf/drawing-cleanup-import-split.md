# Keep drawing computation out of global account cleanup

Status: 25 focused tests in five files pass with one worker and scoped ESLint is
clean. Isolated R9 subsequently built from exact frozen R7 plus these five
production paths. Canonical webpack/TypeScript/prerender passed; no deploy or
runtime server/journeys ran. R8's press-feedback experiment is excluded.

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

## Isolated R9 emitted-byte result

[Canonical R9 proof](artifacts/phase1-cleanup-r9-byte-2026-11-11.json) binds build
`0ff72e5a…` to source fingerprint `a3eb23c6…`. All four modified parent files
matched R7; 5,445 unaffected src/public/scripts/vendor files and all 3,263 public
files remain unchanged. Exactly the reviewed five runtime paths differ, with
one new registry file. Production overlay is absent and stats match the build.

The unchanged formal shared-reference metric falls 485,406 → 475,572 gzip bytes
(9,834 fewer); heaviest screen 755,594 → 753,214. Deployment payload against the
same Phase0 baseline is 1,272,217 bytes. These three ratchets pass against Phase0;
the final 120 KB shared/180 KB heaviest targets remain unmet.

A separate emitted entry-dependency collector, including rootMainFiles, measures
common root/layout JS at 431,270 → 420,663 gzip bytes (10,607 fewer), and the jobs
entry at 476,529 → 466,695 (9,834 fewer). Geometry client, pipe-run-sizes and
pipe-system are absent from both initial closures; the light registry remains.
This is metadata-derived emitted-byte evidence, not browser request/startup or
latency evidence, and it does not redefine the formal gate.

The R7→R9 changed-script target fails: 47/284 current scripts change (237 reused),
549,936 gzip bytes, above 100,000. No HTTP server, journeys, idle observation,
phone work, schema/worker change or activation ran. The final combined candidate
will require its applicable checks; no individual chunk saving was promised
before measuring this build.
