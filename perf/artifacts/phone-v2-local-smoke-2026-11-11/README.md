# Local phone-method v2 smoke — 2026-11-11

Functional **LOCAL** smoke only: three synthetic visited reads completed in disposable host headless Chromium 152. `physicalPhoneEvidence:false`; this is not Pixel, physical presentation, repeatability or a full performance gate. The raw report acknowledges the owned target close with HTTP 200; the raw browser log separately contains termination-status errors during shutdown.

`report.json`, driver source/log, browser log, source evidence, preflight and fixture are direct byte copies. `run.mjs` and `cdp-transport.mjs` were captured at archival time and match the report-recorded SHA256 hashes exactly; they were not reconstructed from git and are not claimed to be execution-start snapshots. `provenance.json` records exact byte sizes/hashes and qualifications. The runtime binding projection is derived, not a full raw config. Original private schema inventory was already cleaned and was not recreated.

These archived sources are provenance, not instructions to launch hardware. Root reported driver session33928 exit0. No browser/ADB/runtime was launched for archival. Previous v1 records remain unchanged.
