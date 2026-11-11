# Local web release recipe

Use Node 26.8.2, pnpm 10.11.1 and the installed frozen lockfile. Both human and agent sessions use the canonical checkout `/home/tim/.openclaw/workspace/kublai`, the same fixed staging name and webpack. Do not alternate this recipe with Turbopack, `next build` defaults, or arbitrary `NEXT_DIST_DIR` names. Never build over the live `.next` symlink.

```sh
node scripts/release/build.mjs /absolute/path/to/new-build
node --test scripts/release/static-assets.node-test.mjs
```

This prepares only the web build, copies retained static URLs from the active build without overwriting any URL, and generates Brotli quality 11 and gzip quality 9 sidecars. A URL collision with differing bytes fails the release. `release-assets.json` records actual script URL reuse and compression bytes. The previous build stays untouched. Keep at least ten completed releases; retained files in the active build are cumulative, so this recipe deliberately errs toward keeping older URLs rather than deleting a phone's dependencies. Disk pruning of assets needs an explicit policy; do not delete them with general rollback-directory pruning.

Serve prepared releases using `node scripts/release/start.mjs` instead of `next start`. The wrapper resolves the build once at startup, serves compressed `/_next/static/` files with `Vary: Accept-Encoding` and immutable caching, and delegates other requests to Next. Brotli takes precedence when accepted; clients excluding Brotli get gzip or raw bytes. The origin binds localhost:3000 by default, matching the existing Cloudflare tunnel. `HOSTNAME_BIND` and `PORT` are optional. No tunnel or hosting change is needed.

For eventual activation, first pass the static and measured lab regression gates, verify current live changes are present, then atomically replace the `.next` symlink and restart only `foremenhq.service`. Its ExecStart must point to `node scripts/release/start.mjs`. Do not restart the worker, rebuild its bundle, or change the database. A deployment must be separately authorized; the builder never performs activation.

Before the first switch, start a candidate on an unused local port with `NEXT_DIST_DIR=/absolute/path/to/new-build PORT=...`, verify an old script URL, request Brotli with curl, and compare decompressed bytes. Cloudflare may choose its own edge encoding; inspect both origin and public headers after activation.

The reproducibility gate requires two same-source, same-env builds from the two builder locations and byte comparisons of every `.js` filename and content. A common recipe alone does not prove this gate. Preserve the report with release measurements; changed source files, source paths, Node versions, environment values and bundlers must be investigated when the comparison fails.

```sh
node scripts/release/compare.mjs /first/build /second/build
```

Measured against the currently active job-numbering release on 2026-11-10: 254 JavaScript files, 11,195,783 raw bytes; gzip quality 9 totals 2,769,440 bytes; Brotli quality 11 totals 2,254,472 bytes. Brotli saves 514,968 bytes (18.59%) against this gzip encoding. This is an offline compression measurement, not a public network measurement or a proven build-churn fix.
