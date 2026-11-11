# Phase 1 raw-navigation lint law

`node scripts/check-navigation.mjs` now blocks new or changed recognized raw
`onClick` navigation. Both `pnpm lint` and canonical release-build preflight run
it. The existing press inventory remains a historical heuristic, not this gate.

The tracked initial inventory contains 32 handlers in 30 exact digest groups;
there is no file-wide exemption. Named local handlers and referenced destinations
are included in the digest. Manual reload/print/simulation and keyboard menu
exceptions retain individual documented reasons. No controls were converted and
no activation timing or destructive/keyboard behavior was changed.

Eleven tooling tests cover violations, shared primitives, exceptions, old-file
additions, edited baseline handlers, deletions, line shifts, and actual lint/build
entrypoint rejection before output work. The same gate passes current source and
frozen R8 without changing either runtime. This is enforcement evidence, not a
navigation latency or release-activation pass. Scope and static-analysis limits
are recorded in [the tooling instructions](../scripts/navigation/README.md).
