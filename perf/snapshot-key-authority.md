# Protected snapshot authority — primitive only

Prepared outside frozen R19/R18. No receiving summary, query allowlist, tRPC
classification, server/database schema, worker or production behavior is switched
here. The existing browser IndexedDB database remains version2 with the same
`authority`, `snapshots`, `assets` stores; no second cache or sync engine.

`DrawingOfflineStore` adds four methods: captureSnapshotAuthority(logicalKey),
saveSnapshotWithAuthority(token,value), readSnapshotWithAuthority(token), and
revokeSnapshot(token). Protected rows use reserved `authority-snapshot:` physical
keys from the first capture. Both ordinary saveSnapshot/readSnapshot reject that
namespace, including before registration and after revocation; ordinary existing
snapshot keys retain their behavior. Logical names are not promoted/migrated from
ordinary rows. Receiving currently has no saved rows to migrate.

Capture registers an opaque UUID key epoch under the composite authority-store
key `[account, physicalKey]`, atomically checking the existing account epoch.
The returned frozen token is backed by a private per-store WeakMap: cloning,
forging or passing it to another store fails. Its metadata couples actual store
instance/lifecycle generation, account epoch, physical key and key epoch. It is
an ordering fence, **not a grant of permission or proof of HTTP success**.

Save/read compare both persisted epochs in the same authority+snapshot transaction
as the record operation. Protected records also carry their key epoch. Revoke
compares the captured epochs, atomically advances only that key and deletes its
row. A stale own token revocation is a no-op and cannot erase a fresh-generation
reading. Old reads/writes reject; a fresh validated store may capture the current
epoch for a later authoritative request. Account clear/purge still advances the
account fence and now removes only its added protected-key metadata while deleting
its existing records. Dispose/A→B→A invalidate old tokens through existing local
lifecycle/account checks. No ordinary query or snapshot is automatically enrolled.

Same-tab revocation dispatches a key/account-only notification; a best-effort
storage signal relays revocation hints to matching-account tabs. Hints cannot
grant authority. New transactions reject old tokens even when events are missed,
a different module/store remains bound or a document reloads. This **does not
retroactively erase a read already completed/painted before revocation**, nor
prove immediate display removal in an inactive tab missing notifications. Future
UI must suppress matching saved display on hint/known denial and revalidate the
persisted token on resume/late-result consumption. Two authorized snapshots in
one unchanged generation are not server-revision ordered; future UI needs its
own request/view ordering and must label saved content as a prior reading.

Four new fake-IndexedDB cases plus the existing offline store suite passed:
**26 unique tests in two files**, one Vitest worker. Cases cover opaque token and
blind-API refusal, two stores/unrelated key preservation/late deferred HTTP save,
independently imported contexts and reload without storage delivery, stale revoke
preserving fresh data, account clear/dispose/A→B→A. Existing download/account tests
remain passing. This proves transaction/lifecycle cases, not browser pixel timing
or retroactive cancellation of a previously returned value.

Scoped ESLint is clean after a type-import-only fixture cleanup; only the new test
was formatted. Logs: `/tmp/drawing-snapshot-authority-tests.log` (26 pass),
`/tmp/drawing-snapshot-authority-lint-final.log`. No app, browser, real DB, full
build/typecheck, benchmark or activation ran. A receiving implementation remains
held until its request-start/read-only-projection/terminal-denial UI is reviewed.
