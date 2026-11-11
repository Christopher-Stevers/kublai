# Deferred PartImage component browser proof — 2026-11-11

**PASS: three bounded component checks in headless Chromium**, using actual PartImage and actual Next/Image implementation, synthetic local SVGs only. [Result](artifacts/part-image-browser-2026-11-11.json). This is not production chunk caching, real-photo fidelity, app latency, Safari, or physical-phone evidence. The existing resource unit tests are separate evidence and were not rerun here.

The [driver](../scripts/test-part-image-browser.mjs) follows the existing `scripts/test-cad-browser.mjs` esbuild/static-server/Playwright convention. Its explicit [metadata seam](../scripts/fixtures/part-image/resource.js) replaces only the deferred metadata resource. The [entry](../scripts/fixtures/part-image/app.jsx) imports actual PartImage. A [standalone CJS interop bridge](../scripts/fixtures/part-image/next-image.js) re-exports the actual `next/dist/client/image-component.js` Image implementation, not a fake img. Next environment definitions are supplied by the standalone harness. Consequently this does not exercise Next's module loader or production metadata chunk cache.

Observed checks:

- Pending and audited DOM boxes were identical: fill 160×120 at (8,8), fixed 96×72 at (188,8). Audited inner SVG matches `viewBox="30 40 500 300"`, 8% offsets, 84% dimensions, xMidYMid meet, #fafafa background and 600×400 image dimensions.
- Rejected metadata displayed actual Next/Image fallback. Later cached metadata rendered an additional audited instance while the already-mounted failed source remained an img.
- A same-page remount with cached fixture metadata while the isolated browser context was offline rendered audited SVG without another resource load call. This proves metadata reuse, not offline asset availability or persistent/reload cache behavior.

Command: `node scripts/test-part-image-browser.mjs`. Each attempt used a dynamically assigned 127.0.0.1 port, one disposable browser/context and a 60-second watchdog; no Next app, authentication, database or release build. All attempts closed browser and server and removed their temporary bundle directory. No external requests were attempted. No screenshot was needed for the numerical DOM/attribute assertions; no visual photo-quality claim is made.

Failures are preserved, not attributed to PartImage:

1. [Attempt 1](artifacts/part-image-browser-2026-11-11-attempt1.json): fixture did not render; source inspection found missing standalone Next-injected environment definition. No checks passed. Initial driver lacked browser-error collection.
2. [Attempt 2](artifacts/part-image-browser-2026-11-11-attempt2.json): geometry passed; Next/Image default CJS interop yielded React #130 on fallback. Fixed by the actual implementation re-export bridge.
3. [Attempt 3](artifacts/part-image-browser-2026-11-11-attempt3.json): geometry passed; actual Next/Image fallback exposed another missing standalone `process.env` definition. Added empty environment object alongside the explicit production definition.
4. [Final log](artifacts/part-image-browser-2026-11-11-pass.log): all three checks passed, zero browser errors. Earlier logs sit beside their JSON reports.

Only concrete standalone harness defects were corrected between attempts; no production component or frozen source changed. Report fixture hashes describe the executed pre-format source. Harness/fixture formatting happened afterward; `node --check scripts/test-part-image-browser.mjs` passed on the formatted source, with no additional browser execution. No activation or production write occurred.
