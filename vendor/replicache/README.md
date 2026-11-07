# Replicache source build

ForemanHQ uses the Apache-2.0 source from Rocicorp's monorepo at
[`0bb091f1719a6277921538dd1d4649a6d47eed48`](https://github.com/rocicorp/mono/tree/0bb091f1719a6277921538dd1d4649a6d47eed48),
dated July 2, 2025. The repository's root LICENSE and Replicache package metadata
at that exact commit declare Apache-2.0. The upstream package version there is
15.2.1; our package version is `15.2.1-foremanhq.apache.20250702`.

This is built from that source. It is **not** the npm 15.3.0 artifact with a
replacement license file. npm 15.3.0 ships a different license and comes from a
different upstream commit. We do not infer a license from the version number.

Rebuild from the repository root:

```sh
node scripts/build-replicache-apache.mjs
```

The builder verifies the downloaded archive SHA-256:
`11725aac407987f8a2adc24e9506b69dfec6871ed37b570ebea0d027ba4fe757`.
For an existing copy, set `REPLICACHE_SOURCE_ARCHIVE` to that archive's path;
the same checksum is required. Build tools are pinned in `build/package-lock.json`.
It uses upstream's TypeScript and esbuild build steps, changes only package
version/packaging, removes the build cache, and includes LICENSE and NOTICE.
NOTICE includes licenses for bundled/runtime dependencies, including compare-utf8.
The public notice is generated at `public/licenses/replicache.txt`.

After rebuilding the tarball, refresh its integrity in the pnpm lockfile by
installing the local file dependency again. Do not substitute a registry release.

## Compatibility verification

```sh
node scripts/test-replicache-upgrade-browser.mjs
```

The test uses real Chromium IndexedDB and ForemanHQ's material-list mutators and
indexes with an isolated local sync server. It verifies persisted 15.3.0 data,
pending offline mutations, pack rounding, exactly-once server application,
another client, reload, and rollback to the previous SDK. It never opens a real
customer database or clears storage to make the migration pass. The old SDK's
idle persistence is allowed to finish before simulating an upgrade.

Supply `PREVIOUS_REPLICACHE_ENTRY` when the old 15.3.0 test artifact is not in
pnpm's cache. The previous SDK is a test input, not a production dependency.
Public type names use upstream's `PullRequest`, `PullResponse`, `PushRequest`,
and `PullerResult` exports; protocol versions, local database names, indexes,
schema versions, and mutators stay the same.

This provenance record covers this dependency change. It is not a clearance of
all ForemanHQ libraries, assets, training data, services, or commercial terms.
