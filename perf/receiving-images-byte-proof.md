# Receiving reading + optional image metadata: canonical proof

The exact reviewed R19 plus ten runtime paths compiled on its first attempt. BUILD_ID `95b57fd012552df60906ffc348a0259308835286a58c08a1ab45284573f7246b`; source fingerprint `d22e346422aa5fc1827c1c6bca58b5eec6ad20badae874c9da0ece8b39eb6c1c`, 2,322 public release inputs. Production TypeScript, prerender and source-law gates passed. Frozen input fingerprints match before/after; all selected postimages, 5,472 unaffected source/public/scripts/vendor files and configuration inputs match their reviewed provenance.

| Unchanged formal metric (gzip bytes) | Phase0 | R19 | New candidate | Phase0 ratchet |
| --- | ---: | ---: | ---: | --- |
| Jobs shared intersection | 502,618 | 477,538 | 478,853 | Pass |
| Heaviest route reference union | 758,531 | 627,737 | 575,264 | Pass |
| Changed deployment versus Phase0 | 2,734,731 | 1,322,620 | 1,379,610 | Pass |

Shared grows 1,315 bytes; heaviest decreases 52,473 bytes; deployment versus Phase0 grows 56,990 bytes. Final shared120,000/heaviest180,000 targets remain unmet. The separate strict **R19→candidate changed-JavaScript payload is 445,298 gzip bytes: FAIL100,000**, with42/288 changed scripts and246 reused. This combined feature update is not a passing typical-small-edit proof, and no threshold changes or timing implications are claimed.

The framing JSON is now emitted as `static/chunks/5587.2e1f308161d4e945.js`: **52,638 gzip bytes**, 223,344 raw. Stats mark it noninitial; it is absent from rootMainFiles and all40 formal jobs page reference lists, including receiving, so it is absent from the formal shared intersection as well. R19's JSON module was concatenated into initial chunk8062 (`8062-a8d540b420c2d695.js`); its223,238-byte webpack size is a pre-minification estimate, not a gzip saving. The new async payload still counts in full deployment bytes. The measured heaviest-route reduction is52,473 bytes, not a promise that every browser avoids all52,638 bytes; eligible image use can fetch it later.

Offline proof decoded exact gzip and Brotli sidecars for all293 current JS/CSS assets, preserved all1,120 active historical static files byte-for-byte, and compared all3,263 source/public immutable runtime files. Native emitted metadata lookup resolves installed postgres3.4.8 through its real native namespace/default binding; no numeric dirname or free named factory was introduced. Development overlay/probe strings remain absent, the original dedicated press chunk is unchanged, and the canonical lock was released.

Only `scripts/release/build.mjs` with frozen source, `RELEASE_BUNDLE_STATS=1`, Node26.8.2/pnpm10.11.1/Next16.1.1 and the verified installed lock ran. Exact command, source identities, metrics, hashes, native inspection and framing allocation are in `perf/artifacts/phase1-receiving-images-build-proof-2026-11-11.json`; the read-only method is `perf/artifacts/phase1-receiving-images-offline-proof.mjs`. First build and proof logs remain under `/home/tim/.openclaw/workspace/releases/speed-proof-20261110/phase1-receiving-images-*`.

No HTTP server, authenticated application, database, worker, browser, full journey, idle observation or activation ran. R19's failed full timing gate remains rejected. This byte/type experiment supplies no replacement timing or activation evidence.
