# PDF interaction improvements — 2026-10-16

The viewer already has progressive raster detail. This change addresses gaps in
loading and offscreen work without changing the PDF format or stored geometry.

## Document loading

Original document files now use the same bounded, descriptor-safe streaming
utility as drawing files, with authenticated GET/HEAD, byte ranges, If-Range,
conditional requests and private revalidation. Document/folder access is checked
before opening bytes or returning metadata, so a cached file cannot bypass a
revoked permission. Whole files are no longer buffered/copied by this endpoint.

Document pages can show an immutable, organization-scoped WebP preview instead
of only blank paper. A short-lived native renderer generates up to 1400px detail;
there are two process slots, a bounded queue and a 30-second process deadline.
The first page starts warming after upload and workspace access. Other pages
prepare on demand. Requests wait at most 500ms for a missing preview before
falling back to the existing backing and exact browser PDF detail; preparation
continues for subsequent opens. The viewer uses the already-known sheet dimensions
to start PDF detail before the preview response arrives, so even a cold preview
miss does not hold rendering behind that 500ms budget. Existing files need no migration. Original PDF
bytes and full-resolution rendering remain authoritative.

## Zoom and overlays

A shared WeakMap contains only bounds from completed full-page recordings. It
follows the PDF page/account cache lifetime rather than persisting private data.
After the first zoomed-in detail appears, a full-page recording of at most
768×768 pixels prepares the missing bounds during settled/visible intervals.
Preparation is shared across consumers, pauses on motion, cancels when abandoned,
has a five-second watchdog and never trusts failed/partial results. There is no
extra preparation barrier before the first detail render. Complex pages that
exceed the deadline retain the ordinary unfiltered path.

Overlays reuse confirmed bounds with their aligned source coordinates. Detail
renders reuse image dimensions instead of reloading each preview for every zoom.
Ink-mask extraction now runs in the same small row batches as accumulation,
allowing input between batches. Canvas readback itself is still synchronous;
this is not a claim to eliminate every overlay stall. Sequential source rendering
and existing memory limits are preserved.

## Verification

- Focused viewer, stream, route, permission, cancellation, search/cache and startup
  tests; document/drawing integration uses disposable PostgreSQL, never production.
- Real native preview test verifies visible ink, dimensions, private mode,
  concurrent request deduplication and reuse without rewriting derivatives.
- Sixteen native PDF crop comparisons cover all four rotations, two vertical
  scales, and normal versus small overview recordings, with byte-exact parity.
- Two existing single-sheet PDFs also passed six selected region comparisons
  using a small preparation render. These local crop timings are not an iPad or
  universal speedup claim. Preparation has an upfront cost that is amortized.
- A production-mode browser fixture exercises first fit/deep opens and repeated
  zoom/pan; raw receipts are in `.tmp/pdf-improvements-20261016/`.

Native iPad frame times, first-open network latency and very large scanned PDFs
still need device measurement. No format replacement or precision reduction is
introduced by this change.
