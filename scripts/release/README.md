# Local web release recipe

The first build creates a persistent private Server Actions encryption key at `.private/release/server-actions.key` (0600). Every builder must use the SAME key through `RELEASE_KEY_FILE` or `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`; never check it into Git or regenerate it per build. Next uses this key as the Server Action ID hash salt, so random keys cause client chunk churn. The builder sets deterministic `RELEASE_BUILD_ID` and `NEXT_PUBLIC_BUILD_ID` from source/config/environment/key hashes.

Use Node 26.8.2, pnpm 10.11.1 and the installed frozen lockfile. Both human and agent sessions use the canonical checkout `/home/tim/.openclaw/workspace/kublai`, the same fixed staging name and webpack. Do not alternate this recipe with Turbopack, `next build` defaults, or arbitrary `NEXT_DIST_DIR` names. Never build over the live `.next` symlink.

```sh
node scripts/release/build.mjs /absolute/path/to/new-build
node --test scripts/release/static-assets.node-test.mjs
```

This prepares only the web build, copies retained static URLs from the active build without overwriting any URL, and generates Brotli quality 11 and gzip quality 9 sidecars. A URL collision with differing bytes fails the release. `release-assets.json` records actual script URL reuse and compression bytes. The previous build stays untouched. Keep at least ten completed releases. For the first rollout set `RETAIN_NEXT_BUILDS` to a JSON array of the previous nine absolute build directories in addition to the active build. Subsequent builds inherit the cumulative retained files from the active build; the recipe deliberately keeps older URLs rather than deleting a phone's dependencies. Disk pruning of assets needs an explicit policy; do not delete them with general rollback-directory pruning.

Serve prepared releases using `node scripts/release/start.mjs` instead of `next start`. The wrapper resolves the build once at startup, serves compressed `/_next/static/` files with `Vary: Accept-Encoding` and immutable caching, and delegates other requests to Next. Brotli takes precedence when accepted; clients excluding Brotli get gzip or raw bytes. The origin binds localhost:3000 by default, matching the existing Cloudflare tunnel. `HOSTNAME_BIND` and `PORT` are optional. No tunnel or hosting change is needed.

For eventual activation, first pass the static and measured lab regression gates, verify current live changes are present, then atomically replace the `.next` symlink and restart only `foremenhq.service`. Its ExecStart must point to `node scripts/release/start.mjs`. Do not restart the worker, rebuild its bundle, or change the database. Activation remains blocked until measured gates pass; respect session authorization. The builder never performs activation.

Before the first switch, start a candidate on an unused local port with `NEXT_DIST_DIR=/absolute/path/to/new-build PORT=...`, verify an old script URL, request Brotli with curl, and compare decompressed bytes. Cloudflare may choose its own edge encoding; inspect both origin and public headers after activation.

The reproducibility gate requires two same-source, same-env builds from the two builder locations and byte comparisons of every `.js` filename and content. A common recipe alone does not prove this gate. Preserve the report with release measurements; changed source files, source paths, Node versions, environment values and bundlers must be investigated when the comparison fails.

```sh
node scripts/release/compare.mjs /first/build /second/build
```

Measured against the currently active job-numbering release on 2026-11-10: 254 JavaScript files, 11,195,783 raw bytes; gzip quality 9 totals 2,769,440 bytes; Brotli quality 11 totals 2,254,472 bytes. Brotli saves 514,968 bytes (18.59%) against this gzip encoding. This is an offline compression measurement, not a public network measurement or a proven build-churn fix.

## Reproducibility proof (2026-11-10)

Two isolated source locations under `releases/speed-proof-20261110/clean-{a,b}` used commit `6ebbef879b9952592afcd48a0ef9fae0bd00d29a` plus the release/config overlay. All 4,392 selected input files matched. Dirty/untracked zoom, packing-slip and other concurrent source edits were excluded **only from these proof snapshots**; this is not the eventual deployment candidate.

With shared private Server Actions salt and normalized webpack ID input, both complete Next builds passed TypeScript/prerender and produced 254/254 identical current JavaScript filenames and bytes. After retention, all 507/507 JavaScript files matched. Source hash: `ad7cf27f4c6fffa798085bb2880e8538f2f168d864a288576b78e72bfff102ca`. Reports are `normalized-comparison.json`, `normalized-compiled-comparison.json`, and each build's `release-assets.json` under the proof directory.

The initial transition from the current live pipeline still changes 253/254 URLs. No small source-change deploy byte budget has been proved yet. The proof builds predate the packaging-only automatic output `node_modules` symlink addition; that symlink was created manually for HTTP verification. A final candidate must include all approved live changes and pass the measured lab gate.

The normalized candidate origin on localhost:3187 served all 254 previous-live and all 254 current script URLs as Brotli with byte-identical decompressed payloads; `/sign-in` and `/api/health` returned 200. This validates origin behavior, not Cloudflare edge negotiation. No live symlink/service was changed.

`node scripts/release/script-map.mjs .next` emits a manifest dependency map with exact raw bytes and per-file gzip level 9 totals. It unions client-reference chunk lists and root main files, then intersects jobs routes for shared chunks. This may include conditional references, so treat it as a dependency map rather than an observed browser startup trace.
