# Drawing markup clarity at close zoom — 2026-10-11

Saved markups and dimensions previously lived inside the sheet's CSS-transformed image layer. On a phone, that layer can be composited into a bitmap and enlarged along with the image. At 1,831% zoom, the image's sharp PDF patch can remain clear while annotation strokes and count text look blurry.

The viewer now places saved markups, drafts, issue pins, measurement marks and pipe highlights in separate viewport-sized SVGs. A shared camera maps their original sheet coordinates to the same pixels as the image, including pan offsets, aspect ratio, margins and zoom. The camera follows each animation frame. Saved ordinary ink stays memoized; no point conversion or state update is needed for each gesture frame. Printable and exported SVGs retain their full-sheet coordinate system.

The live SVGs clip at their own viewport edges. This bounds offscreen painting and avoids allocating a zoomed full-sheet annotation surface. The raster sheet keeps the existing immediate CSS-transform movement and PDF/tile pipeline.

## Verification

- 224 tests across 20 drawing, geometry, measurement and PDF-export test files passed.
- TypeScript and ESLint checks passed for the affected code.
- Production build passed.
- Camera tests cover 100%, 1,831% and 2,400% zoom, landscape/portrait layouts, normalized annotations and active measurement coordinates. Gesture tests verify camera updates before the 50 ms React/tile commit and reuse of saved count text nodes.
- A private Chromium harness used the actual M-103 annotation geometry with a synthetic vector background, without modifying drawings or records. Portrait and landscape checks at 1,831% and 2,400% confirm pixel alignment, viewport-sized unscaled overlays, touch selection and a two-finger pinch from 100% to 700%.
- At 390 × 700 CSS pixels, device pixel ratio 3 and 4× CPU throttling, three 120-frame wheel trials at each close zoom had 95th-percentile frame intervals of 16.7–16.8 ms and no intervals above 50 ms. The old overlay's transformed bounds were about 7,141 × 5,356 CSS pixels at 1,831%; the new overlay remains 390 × 647.

Chromium on this workstation does not reproduce every Android GPU/compositor behavior. These checks establish vector camera alignment, sharp browser rendering, bounded painting and gesture performance; they are not a physical-phone measurement. The user should refresh FormanHQ before checking the same sheet on their phone.
