# Local web release recipe

Use Node 26.8.2, pnpm 10.11.1 and the installed frozen lockfile. Invoke the same recipe from either source checkout (`RELEASE_SOURCE_DIR` can select an explicit frozen source snapshot):

```sh
node scripts/release/build.mjs /absolute/path/to/new-build
node --test scripts/release/static-assets.node-test.mjs
```

Every invocation snapshots its source to one locked workspace, `~/.cache/foremanhq-release-builder`, then compiles with webpack at the fixed `.next-release-build` path. Concurrent callers fail explicitly instead of mixing sources. This is necessary because Next's generated Flight entry requests and external dependency identifiers contain absolute paths; ordinary webpack deterministic IDs alone do not make builds portable. Keep builder versions, dependencies and environment identical.

A persistent private Server Actions salt defaults to `~/.local/share/foremanhq-release/server-actions.key` (0600). `RELEASE_KEY_FILE` or `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` can override it. Every caller must share the same key; never check it into Git or regenerate it per build. Next uses this salt for Server Action IDs. The recipe exports deterministic `RELEASE_BUILD_ID` and `NEXT_PUBLIC_BUILD_ID` from the source/config/environment/key fingerprint.

The recipe prepares only the web build, retaining static URLs without overwriting any URL. A URL collision with different bytes fails. For the first rollout set `RETAIN_NEXT_BUILDS` to a JSON array of nine previous absolute build directories, in addition to the active build. Later builds inherit cumulative retained files. The recipe emits Brotli quality 11 and gzip quality 9 sidecars; `release-assets.json` records actual filename reuse and byte totals. No worker bundle, service, live symlink or database is changed.

The output packages an immutable `runtime/public` snapshot and a dependency symlink. `node scripts/release/start.mjs` uses that runtime directory and the built Next configuration, so changes to canonical `public/` cannot silently change an activated release. It serves retained `/_next/static/` files with immutable caching and `Vary: Accept-Encoding`, preferring accepted Brotli. Other requests go to Next. The origin defaults to localhost:3000, matching the Cloudflare tunnel. `HOSTNAME_BIND`, `PORT` and `NEXT_DIST_DIR` are optional.

Activation remains blocked until the applicable measured gates pass; respect session authorization. A measurement bootstrap can collect the baseline without claiming the later speed targets have passed. For eventual activation, inspect the exact candidate, then atomically switch `.next` and restart only `foremenhq.service`, whose ExecStart must use the pinned wrapper inside the selected build. Keep the prior ten completed releases. General rollback-directory pruning must not delete retained assets.

For candidate HTTP checks, explicitly set `FOREMANHQ_BACKGROUND_MODE=separate BIM_WORKER_DISABLED=1` and use an unused local port. Verify old script URLs, Brotli decompressed bytes, sign-in, health, and that `/sw.js` matches the packaged public snapshot. Inspect public edge headers after activation; Cloudflare may choose its own encoding.

```sh
node scripts/release/compare.mjs /first/build /second/build
node scripts/release/script-map.mjs .next
```

The comparison checks every JavaScript filename and byte. The script map emits metadata only: route templates, counts, exact raw bytes and gzip level 9 totals. It unions client-reference dependencies plus root main files and intersects jobs routes for shared chunks. Conditional references can overstate observed startup requests.

Measured against the live job-numbering release on 2026-11-10: 254 JavaScript files, 11,195,783 raw bytes; gzip quality 9 totals 2,769,440 bytes; Brotli quality 11 totals 2,254,472 bytes. Brotli saves 514,968 bytes (18.59%). This is an offline compression measurement, not an edge network measurement.

Earlier sibling-directory builds matched 254/254 current scripts and 507/507 after retention. A stronger different-depth check failed, motivating the fixed staging recipe above; those earlier matches do not prove general path portability. The initial migration from the live pipeline can still rename nearly every script. A small-source-change deploy byte budget must be measured separately.

Canonical invocation proof: the same clean Phase 0 source was built sequentially by calls from `/home/tim/.openclaw/workspace/kublai` and `/home/tim/.openclaw/worktrees/foremanhq-ui` using `RELEASE_SOURCE_DIR`. Both compiled at the fixed workspace: all 255 current scripts and all 508 scripts after active-build retention matched byte for byte. After adding the nine most recent `foremanhq-*` release builds, all 1,104 scripts matched. Reports remain local under `releases/speed-proof-20261110`; no production identifiers or user content are committed.

The candidate's pinned `runtime/release/start.mjs` plus helper were tested on a separate local port with separate background mode and BIM disabled. All 255 current scripts and a sample from each of ten previous builds returned 200 and matching bytes. `/sw.js` matched the packaged e1b baseline and differed from the mutable canonical worker; sign-in/health returned 200 and unauthenticated tRPC remained 401. The packaging-only runtime configuration and pinned helpers were completed after webpack compilation and checked through actual startup. Preserve current live public data assets when constructing a code-only bootstrap snapshot: 966 untracked catalogue images were copied into the immutable public snapshot without changing its worker/offline page.

The pinned service command is `node .next/runtime/release/start.mjs`, retaining the canonical application WorkingDirectory so uploads/data paths remain stable. All four production environment variants remain server-only references to their persistent source files; none are copied beneath public. The disposable-workspace guards reject source/output/active/key/dependency paths and nested input symlinks resolving into that workspace before cleanup.
