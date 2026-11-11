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

## Phase 0 activation record

Root activated the reviewed Phase 0 candidate at 2026-11-11 00:38 UTC. Root's activation checks recorded public/origin health and sign-in 200, Brotli bytes matching the new JavaScript, exact public bytes for all ten sampled historical releases, and service `NRestarts=0`. The service keeps the canonical WorkingDirectory and separate background mode; `zz-speed-release.conf` selects `.next/runtime/release/start.mjs`. Numeric field logs use `~/.local/share/foremanhq-performance`. This is measurement bootstrap activation, not a claim that the eight-journey speed targets have passed.

Phase 1 preparation adds five-minute client-router page retention, fresh account/build verification for private Flight bindings, identity-wide invalidation after a known denial, and cancellation/clearing of all account query memory. It also generates a public changed-asset manifest, warms missing changes only on a known good link, waits for quiet/no-edit/no-mutation conditions, and guards reload to once per explicit build. Cold unauthenticated documents still do not replay private HTML. These changes are not activated; browser integration and the measured lab gate remain necessary.

After Phase 1 builds are allowed to run, use `node scripts/release/check-small-change.mjs /phase0-build /phase1-build` to record the changed current JavaScript gzip payload and enforce strictly under 100,000 bytes. Do not infer this result from identical-build reproducibility. No large build was run while the Phase 0 lab matrix was active.

## Controlled edit and Phase 1 foundation measurements

Both frozen builds passed webpack, TypeScript, and prerendering under the pinned canonical toolchain. A controlled Phase 0 page-title edit reused 249 of 255 scripts and changed six: 39,423 gzip bytes, below the 100,000-byte target. The full Phase 1 cache/update foundation separately reused 112 of 258 scripts and changed 146: 947,890 gzip bytes, so that update payload fails the target. Neither experimental build was activated. The passing controlled edit does not excuse the foundation failure.

The shared dependency map remains one unchanged definition: framework root files plus the intersection of jobs page dependencies. Phase 0 totals 502,618 gzip bytes (117,929 framework; 384,689 application). Phase 1 totals 509,659 (117,952 framework; 391,707 application). The optional non-mutating client stats observer produced real compiler attribution. Named top-level module/chunk IDs recover filtered dependent groups; per-module sizes remain pre-minification estimates, while emitted chunk gzip totals are exact. Sanitized evidence is in `perf/artifacts/phase1-cache-static-2026-11-10.json`; raw local stats are not committed.
