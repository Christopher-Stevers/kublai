# R12 source proposal — not built

Start from immutable R11 (`ae52a68dd64be4099077ac95c7ad489255c3501dda164a7d5b9bf023ee95d668`, original-source fingerprint `71410fbee1832a3dc141c47ef790edf9093c6e5146beac3842534503f7a8b0f3`). The [proposed exact runtime inventory](artifacts/phase1-r12-source-proposal-2026-11-11.json) records all parent/result digests and patch hashes.

| Reviewed group | Commit chain | Runtime paths |
| --- | --- | ---: |
| Ordinary unsent row partition | `49e911d3` | 3 |
| Accepted merge refresh / motion / late-ACK guard | `3c322416` + `1a1d88a4` | 1 |
| Snapshot portal observer only while active | `9970d723` | 1 |
| Optional comparison viewer import boundary / shared fallback controls | `5d2130c8` + `90ca286f` | 2 |

All six listed patch groups have exact sequential parent matches against R11 plus earlier listed groups, and source-only apply checks pass. They change seven unique runtime paths; no operational recipe changes are currently proposed. This is a patch proposal, not a complete runnable snapshot, and no new build fingerprint or byte result is claimed.

The final scale hardening commit is pending verification/root review and is **not included**. After that exact ID/allowlist arrives, root must review the final inventory before a canonical build. A future full freeze must recheck every unaffected input and all 3,263 public files. Never assemble from current HEAD or dirty files. R8 attribute press feedback, schema/worker executable, PackingSlips, zoom, package/lockfile and tsconfig remain excluded.

The comparison facade retains its named export/props and conditionally mounted callers. Its content is an exact implementation move. Eight focused tests pass; facade/tests lint clean; four pre-existing moved-content lint findings are unchanged. The shared Button follow-up removes the dummy boundary property and preserves default release behavior for fallback Close/retry. No comparison warming or page reload action is introduced.

R11's unchanged heaviest ratchet has only 735 bytes of headroom; final targets and strict changed-script gate still fail. Ordinary-row, idle-observer and comparison boundaries have no measured canonical byte/timing saving yet. The 91,743-gzip-byte comparison-containing chunk is an upper bound on that source target, not a promised saving. No R12 build, server, journey or activation has run.
