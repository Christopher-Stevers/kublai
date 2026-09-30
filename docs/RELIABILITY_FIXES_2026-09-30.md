# ForemanHQ reliability and performance fixes

Implemented the eleven findings in [the September 30 audit](PERFORMANCE_RELIABILITY_AUDIT_2026-09-30.md). Existing sorting, photos, offline use, and manual/confirmed room protections are preserved.

## Changes

1. **Durable quantities:** valid edits enter an account-scoped localStorage journal before asynchronous Replicache writes. Recovery replays pending edits after navigation or reload; only a matching server acknowledgement removes them. Storage/write failures show a retry action.
2. **Upload recovery:** locks record process start identity and boot ID. Dead owners and expired reservations recover safely, incomplete uploads can restart, and session writes are flushed to disk before atomic publication.
3. **Resilient offline caching:** service-worker v11 tolerates denied/full cache storage without failing successful network responses. Page, static and image caches have entry limits.
4. **Detection isolation:** every run has a unique ID; stale workers cannot overwrite a newer result. Room writes and completion commit together. Detection has two-worker admission, independent heartbeats, a ten-minute deadline, memory/PID limits, and launchers that resolve the installed Node runtime.
5. **Cheaper sync checks:** transactional PostgreSQL revisions replace repeated full-table fingerprints. Triggers cover deletes, direct SQL, rollback and shared metadata. Organization-specific writes avoid invalidating unrelated organizations. Migration 0039 is additive; cached views use a new namespace while mutation protocols remain compatible.
6. **Less client work:** list/quote/job indexes replace workspace-wide item scans. Dashboard headers avoid loading every line, unchanged table rows reuse rendering, and supplier data parses once per cache version. Broad virtualization was not required by the audit and is deferred pending device profiling.
7. **Bounded graphs:** room graphs have TTL/LRU eviction, four-entry/48 MiB estimated limits, source-aware pending deduplication and one active graph build per HTTP process. Invalidated work cannot repopulate the cache or bypass admission limits.
8. **Visible room-save failures:** serialized edits share success reconciliation and retain failed values for retry.
9. **Screen recovery:** page and deferred-feature boundaries provide retry/reload. Only transient read failures retry automatically; general write mutations do not.
10. **Complete backups:** the existing nightly task now snapshots the database, uploaded drawings and catalog photos into versioned, content-addressed local and offsite storage. Fourteen completed versions are retained. The existing warm standby refresh is transactional.
11. **Usable lint gate:** the removed Next.js lint command is replaced by ESLint flat configuration and a no-new-errors baseline. `pnpm check` runs type checking and that gate; `pnpm lint:strict` exposes existing debt. No lint rules were disabled.

## Verification

- 199 application tests across 41 files passed.
- 21 recovery/cache fault tests passed.
- Real PostgreSQL sync integration and isolated revision/fencing tests passed, including rollback, direct writes, deletes, unrelated organization isolation, process identity and an actual bounded worker launch/failure.
- A complete offsite restore verified 956 files, restored 6,704 parts and 89 jobs, and checked all 716 local asset references in that database with zero missing files.
- Headless Chromium mobile emulation passed catalog, material table, Add Part, Settings and landscape checks with no browser exceptions. An offline edit survived immediate back navigation and a hard reload, then reached PostgreSQL after reconnect.
- Local revision-query sampling reduced the median from 3.117 ms for the old catalog fingerprint to 0.0498 ms for counters. This is a database-query measurement, not an Android page-load claim.
- Type checking and the lint gate pass with zero new errors. Strict lint still reports 2,161 inherited errors; those are baseline debt, not fixed by this change.

These checks do not establish physical Android timing or live AI detection accuracy. A browser that denies durable local storage cannot accept journal-backed quantity edits; the UI reports that failure rather than silently losing changes.

## Recovery commands

Run from the repository with the existing server credential files available:

```sh
node scripts/ops/backup-snapshot.mjs restore latest /absolute/empty-restore-directory
bash scripts/ops/rehearse-backup.sh
```

The first command restores and verifies offsite database/files into an empty directory; it does not replace production. The rehearsal restores into a disposable PostgreSQL cluster and verifies database asset references. Local chunks and manifests are retained alongside nightly dumps. Credential files remain outside Git.

## Release verification

Released `.next-reliability-release-20260930` after an isolated production build. Local and public health checks pass. Live mobile-emulated checks pass, including offline immediate navigation/reload and reconnect persistence. A previous-build client retained all seven tested static assets and opened Add Part after the server changed, with zero browser exceptions. The previous build and static assets remain available for rollback.

The updated nightly service completed a fresh post-migration snapshot and transactional Ubicloud standby refresh successfully. The existing nightly timer remains in use.

Post-release snapshot `20260930-091623` passed a complete restore of all 956 files and all 716 database asset references. It contained one temporary browser-test job captured before cleanup. Final clean snapshot `20260930-092418` has an independently verified and restored offsite database with 6,704 parts, 89 jobs, zero test jobs and the revision table. Its 955 asset files have identical hashes and chunk lists to the fully restored snapshot. The refreshed warm standby also has 89 jobs and zero test jobs.

## A511 follow-up: detection startup appearing stuck

A production hybrid run exceeded the new 2 GiB cgroup memory ceiling and exited with code 137; cgroup events confirmed an OOM kill. A read-only reproduction on the same page completed at 5000×3750 pixels with 53 labels, 36 outlines and approximately 2,123 MiB peak RSS. The detector now has a 4 GiB ceiling; two-worker admission, the JavaScript heap cap and ten-minute deadline remain in place.

The selected floor's status query no longer depends on local launch/edit state. It polls once per second during launch/running work and every five seconds otherwise, and ignores cached terminal results while the launch mutation is pending. A mobile-emulated browser test with controlled worker responses verified cached failure → new progress, at least three continued polls, terminal failure visibility and an enabled retry button, with zero browser exceptions. Type checking and the no-new-errors lint gate pass.
