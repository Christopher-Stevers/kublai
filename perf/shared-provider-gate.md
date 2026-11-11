# Shared-layout provider law

A source-only provider gate now runs in lint and canonical build preflight. Its
initial tracked baseline covers 35 exact imports/usages in root/jobs layouts and
their shared children wrappers. New provider boundaries and additional mounts
fail; ordinary components, line shifts and deletions pass. Existing voice provider
module/export identity is preserved while its internals split.

Exceptions record exact identities/counts and purposes. Removed identities must
be retired in the reviewed ledger to block later restoration. The gate does not
invent historical state from a frozen source snapshot. Eleven focused tests cover
root/jobs additions, aliases, wrappers, provider internals, deletion/retirement,
exceptions, and actual lint/build failure before output work. Full scope and
limits are in [the tooling instructions](../scripts/layout/README.md).

No runtime behavior changes, provider conversions, builds or activation occurred.
No general polling ban is introduced: authority/live migration remains incomplete.
