# Receiving and image source proposal — 2026-11-11

Source-only preparation; **awaiting root review and separate build authorization**. No compile, app, database, browser, timing capture or activation was started. This is a byte/type proof proposal, not a timing retry.

Source: `/home/tim/.openclaw/workspace/releases/speed-phase1-receiving-images-20261111`.
Base: exact frozen `speed-phase1-combined-r19-20261111`, build `47b6e70541a3f513f852e93aef05aa4f389544f72f4626082f447f53d0956ece`, fingerprint `4541b37e0ff7144287d9187384eeb9ae7ebe1c9aa88e31fcaa53cee03a8b05c7`.
Proposed fingerprint: `d22e346422aa5fc1827c1c6bca58b5eec6ad20badae874c9da0ece8b39eb6c1c` (2,322 source files).

The [manifest](artifacts/phase1-receiving-images-source-freeze-2026-11-11.json) records every preimage/postimage hash and compatibility check. The [source-only composition method](artifacts/receiving-images-freeze-method-2026-11-11.mjs) copies frozen R19 and reads only selected committed runtime blobs; it does not archive HEAD. Local preparation log: `/tmp/receiving-images-source-freeze.log`. The snapshot also contains `REVIEWED_SOURCE.json`.

## Exact runtime changes

| Group | Paths | Postimages |
| --- | --- | --- |
| Receiving | `src/components/materialLists/MaterialListScreen.tsx`, `SavedOrderReading.tsx` in the same directory; `src/hooks/use-receiving-order-read.ts`; `src/lib/receiving-order-reading.ts`, `tier-one-cache-budget.ts`, `device-query-cache.ts`, `drawing-offline.ts`; `src/server/api/routers/materialList.ts` | `7286af50` |
| Image metadata | `src/components/catalogue/PartImage.tsx` | `46a30bf2` |
| Image resource | `src/lib/part-image-layout-resource.ts` | `e206f3a6` |

Exactly **10 changed runtime paths, 5 new files**, no deletions. Ordinary selected parents match R19 exactly. The full `drawing-offline.ts` postimage intentionally includes the `9ace848a` protected-key primitive: R19 matches that prerequisite's parent, and its postimage matches the receiving commit's parent. PartImage similarly verifies the `e206f3a6` → `46a30bf2` chain. No intermediate archive or unrelated commit overlay is needed.

The full input corpus contains 5,488 files: 5,478 byte-identical to R19 plus these ten changed/new files (base: 5,483). All **3,263 public files** and every script/vendor/config input are byte-identical. `src/lib/part-image-layouts.json` is unchanged. Node 26.8.2, pnpm 10.11.1, Next 16.1.1 and installed lock identity match R19; next.config SHA-256 remains `047f4d6aa8546b21956b5c3f9bef5a7a3e8520b1e1fd7cf4f25d4a9d6fbe7892`. The existing private canonical build fingerprint was verified without recording secret inputs.

R19's usePress, Button, QuantityControls and JobsClient postimages are unchanged, including the badge refresh-behind slice. This proposal makes no causal timing reversion. The rolled-back notification experiment, unrelated dirty PackingSlips/schema/worker/zoom/tsconfig, and newly added tests/docs/diagnostic methods are excluded from runtime composition. Existing frozen source tests remain unchanged.

Receiving's prior evidence is 103 focused tests/11 files and the scoped current-source TypeScript check; it is not a canonical production build. Storage-unavailable durable deletion remains explicitly limited as documented in [receiving proof](receiving-saved-order.md). Images preserve the reviewed deferred-resource correction. Canonical byte/type, retained assets and emitted runtime checks remain unmeasured for this new composition. R19's failed timing gate is unchanged and no activation or full capture is scheduled.
