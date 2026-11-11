# Material-list merge: feedback and accepted refresh

The existing merge flow selected a destination immediately, but its success
callback waited for a 500 ms card animation before requesting sync and refreshing
the lists. A target pulse then took another 300 ms. That made decorative motion
hold an already accepted result and the pending controls.

The target selection now drives the pending banner and disabled controls in the
same render, without waiting for the mutation observer to update. Both source
and target expose `aria-busy`. The existing synchronous attempt latch still
rejects repeated target selections and cancellation during dispatch.

Only a real successful merge response clears selection, requests Replicache
sync, refreshes the caller and reports its actual moved count/source outcome.
These actions no longer await motion. The source clone and target pulse run
concurrently for 150 ms, respect reduced motion and cannot turn an accepted
merge into an error if animation is unavailable or interrupted. Temporary
clones are cleaned on completion, cancellation and unmount. A response arriving
after unmount still requests authoritative sync but cannot revive the old view,
show a notification or append an animation. The actual list
contents still come from the authoritative sync; no counts, source deletion
or server identity are invented.

Validation: 15 tests across the merge hook, material-list view and Jobs tools
pass. They include local pending feedback while the mutation observer still
says idle, repeated submissions, refusal/retry, actual accepted result,
unresolved animation completion, unmount cleanup, unavailable/cancelled
animation and reduced motion. Production hook ESLint passes.

This is a later prepared slice, excluded from frozen R11. Tests do not prove
frame latency, phone performance, offline convergence, durable acknowledgement
after a lost response, or all first-twenty writes. The existing mutation
transport/account guards and retry policy were not expanded by this motion
change. No production runtime, schema or worker change was made.
