# R12 reviewed source and canonical byte proof

Start from immutable R11 (`ae52a68dd64be4099077ac95c7ad489255c3501dda164a7d5b9bf023ee95d668`, original-source fingerprint `71410fbee1832a3dc141c47ef790edf9093c6e5146beac3842534503f7a8b0f3`). The [proposed exact runtime inventory](artifacts/phase1-r12-source-proposal-2026-11-11.json) records all parent/result digests and patch hashes.

| Reviewed group | Commit chain | Runtime paths |
| --- | --- | ---: |
| Ordinary unsent row partition | `49e911d3` | 3 |
| Accepted merge refresh / motion / late-ACK guard | `3c322416` + `1a1d88a4` | 1 |
| Snapshot portal observer only while active | `9970d723` | 1 |
| Optional comparison viewer import boundary / shared fallback controls | `5d2130c8` + `90ca286f` | 2 |

The initial six listed patch groups have exact sequential parent matches against R11 plus earlier listed groups. Their proposal is retained above; final scale hardening is added below. No operational recipe changes or new byte result are claimed.

Root reviewed and approved final scale hardening `0e421442` (five runtime paths: DrawingWorkspace, DrawingSheetViewer, useDrawingEditor, use-drawing-scale-save and drawingsWorkspace router). Its typed acceptance/refusal result, account/read-authority checks, per-sheet request latch, local/query revision ceiling and nonblocking refresh were independently reviewed. Navigation reports 214 passing focused tests and no added lint findings against its baseline; this is source/test provenance, not candidate runtime evidence.

The [final exact source inventory](artifacts/phase1-combined-r12-source-freeze-2026-11-11.json) records all seven groups, intermediate preimages/postimages and patch hashes. Every sequential preimage matches exactly; all patches apply cleanly. Final source is `/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r12-20261111`: 12 runtime paths changed, zero operational changes, 5,456 unaffected source inputs and all 3,263 public files identical to R11. Named configs/package/lockfile/tsconfig and the worker executable remain unchanged. Original-source fingerprint is `f8aea0644b7c7471a1bdae597535001c44a6e0a337b8ef875da68e9c24327c09` (`foremanhq-lab-source-v1`, 2,308 files).

Root independently reviewed all final postimages/preimages and authorized the following pinned canonical command, which exited 0 first try:

```sh
RELEASE_SOURCE_DIR=/home/tim/.openclaw/workspace/releases/speed-phase1-combined-r12-20261111 RELEASE_BUNDLE_STATS=1 node /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r12-20261111/scripts/release/build.mjs /home/tim/.openclaw/workspace/releases/speed-phase1-combined-r12-20261111/.next-web
```

 Never assemble from current HEAD or dirty files. R8 attribute press feedback, schema/worker executable, PackingSlips, zoom, package/lockfile and tsconfig remain excluded.

The comparison facade retains its named export/props and conditionally mounted callers. Its content is an exact implementation move. Eight focused tests pass; facade/tests lint clean; four pre-existing moved-content lint findings are unchanged. The shared Button follow-up removes the dummy boundary property and preserves default release behavior for fallback Close/retry. No comparison warming or page reload action is introduced.

R11 began with only 735 bytes of heaviest ratchet headroom. R12's [canonical byte/source report](artifacts/phase1-combined-r12-byte-2026-11-11.json) now records successful webpack, production TypeScript, prerender and both source-law preflights, with the original-source fingerprint rechecked after build. Build is `d18cbd7b82933e2e0dc0999ccfcf2054aa7cf095946de1a379d6b0365e8b7736`. All 12 reviewed overlays, 5,456 unaffected inputs and 3,263 public files remain exact; development overlay module/text are absent.

Unchanged formal metrics: shared **478,116** (+162), heaviest **640,641** (−117,155; receiving), Phase0-relative deployment **1,316,329 gzip bytes** (+22,389), versus R11. All three Phase0 byte ratchets pass; heaviest headroom is now 117,890 bytes. Final 120KB shared / 180KB heaviest targets remain unmet. Strict R11→R12 changed payload **541,833 gzip bytes**, 39/287 scripts changed (248 reused), fails the unchanged **100,000-byte** target. This multi-feature batch is distinct from prior controlled single-leaf edit evidence.

Supplemental [emitted entry dependency collector](artifacts/phase1-r12-initial-collector.mjs) measures receiving initial JS **691,062→573,783 gzip bytes** (−117,279). FileComparisonContent, DrawingSheetViewer and PassiveDocumentPdfPreview are absent from that initial graph; the lightweight facade remains. Common/Jobs initial bytes rise by 44/162. These are net combined-candidate measurements, not an isolated comparison-feature saving or browser request/timing evidence. The original 91,743-byte mixed chunk was an audit target, not the measured net result.

No HTTP server, browser journey, idle observation, full candidate matrix or activation ran. No CPU/timing gain for ordinary rows, snapshot observation, merge or scale is claimed. Earlier failed performance gates remain unchanged.
