# Quick-wheel anticipation

The selection delay remains 500 ms. After 50 ms over a choice, prepare the next
step and gradually crossfade it into view for the remainder of that same delay.
The original step continues to own hit testing until the full dwell completes.
Moving to a different original-step choice resets its dwell and preview. Release,
Escape, cancellation, resize, loss of focus or returning to the dead zone cancels
both. Preview contents have no selection callbacks or input targets and are hidden
from assistive technology until the actual step is selected.

Pure look-ahead uses the current catalogue's scoped facets, including supplier
mode and exact reducing sizes. It mirrors forward skips of empty steps and the
wheel's flat material choices. Paging previews the upcoming page with the same
usage ranking and edge-aware layout. No wizard state, saved destination, quantity,
selection history or catalogue record changes during anticipation.

Category previews show the first parts and load their photos. Existing local
parts are reused; otherwise the normal parts query is fetched through its shared
query cache, with the existing 5,000-row bound. A slow or failed speculative read
does not block confirmation, and stale results cannot reappear after cancelling
or moving away. The wheel still ends after Category. Supplier listings continue
to use their supplier-scoped queries.

The preview follows the pointer within the original sector so its centre agrees
with the normal recenter-on-confirm behavior. It uses the same circle/curved
layout and preserves the dead zone and uncovered wizard header. Previewed tiles
do not replay their entrance animation at confirmation. Reduced motion removes
the crossfade motion while preserving the same 500-ms input safety delay.

Validation: pure facet previews, scoped query preloading without committing,
original-step input through 499 ms, exactly one action at 500 ms, changing choices,
late/failing reads, early release/cancellation, paging, normal cards, usage ranking,
size families, supplier mode, and existing curved-wheel/dead-zone tests. A Chromium
phone-sized fixture verifies progressive opacity, input handoff and no repeated
tile entrance at confirmation.
