# Deferred audited photo framing

Prepared Phase 1 slice only; not included in frozen R19 or a new candidate.

PartImage now imports a small resource loader. The 1,467-entry audited JSON is unchanged and lives behind a dynamic import, requested only for local `/api/catalogue/images/<filename>` sources. Concurrent images share one pending import; successful metadata remains in memory across images and revisits. External, blob, static-import and other local images bypass it.

While uncached metadata is pending, an empty SVG preserves the same width/height or absolute fill box, class, style and accessible name as audited rendering. No original pixels appear before an audited crop. Once available, audited SVG rendering is unchanged; unknown catalogue paths use the ordinary Next image. Failed imports use the original image. That fallback is latched for the mounted source so another image's later successful import cannot visibly recrop it. Source replacement creates a new source-bound instance; later mounts may retry. There is no online-event retry or polling and no permanently cached rejection. Dynamic-import network/cache behavior still depends on the browser; in-memory cached metadata works offline, but an uncached offline failure uses the safe original image.

Existing callers include fixed-size table/receiving thumbnails and fill containers. Their outer dimensions remain reserved; the intentional new behavior is a blank photo box while framing metadata is pending. Photos, pixels, API authorization and audited coordinates are unchanged. Caller onLoad/onError behavior is unchanged after an ordinary Next image is selected; audited SVG already did not forward these callbacks.

Evidence: frozen R19 chunk8062 is 224,175 raw / 53,313 Node gzip9 bytes, mostly the 223,238-byte pre-minification JSON module. It contributes to four formal route unions including receiving (627,737 total), not the 477,538 jobs-shared intersection. These are existing emitted bytes, not promised savings or observed startup requests. Exact future canonical graph/bytes and browser loading/offline behavior still require proof.

Focused checks: 10 tests across PartImage, resource loader and the unchanged 1,467-entry bounds test pass. Tests cover deferred framing/box/accessibility, unknown/external sources, source replacement, failed offline fallback, revisit retry, and pending/success deduplication. Scoped lint has no errors; the Next-image test mock retains the existing img warning. No build, browser, timing or deployment was run.
