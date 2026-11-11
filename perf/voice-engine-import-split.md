# Optional voice engine import split

The R9 emitted common-entry graph includes the combined `VoiceProvider` module (21,699 pre-minify bytes). This is attribution, not an estimate of transferable gzip savings. The Dev-feature check executes after that module has been imported.

The lightweight context/card now imports the engine through `React.lazy`. Workspace children remain siblings of the engine's Suspense/error boundary, continuously mounted while it loads or retries. The card appears only after the engine has committed its controls and status. Starting from the card still calls the existing microphone-start function synchronously in the user's event. No request, microphone, session, proposal-confirmation or account-key lifecycle logic is changed; engine unmount retains the existing abort/generation/microphone cleanup. The existing parent account/simulation key still destroys the controller.

A failed optional engine import offers local retry without reloading the workspace. Ordinary accounts with Dev features disabled do not mount or request the engine. No model API, server authorization, schema, worker, package or lockfile changes are involved.

Validation: six focused mocked tests pass, including no automatic microphone start, explicit proposal confirmation, hidden-tab pause, unmount cleanup, turning Dev off, and retaining the exact workspace input node/draft through engine loading. Scoped ESLint passes for the three edited/new TSX files. Tests use Node's `--no-experimental-webstorage` so JSDOM supplies localStorage; the first invocation without that flag failed on Node's missing localStorage implementation, not an engine assertion. No live model or microphone is used.

Canonical R10 evidence is recorded in [the byte report](artifacts/phase1-voice-r10-byte-2026-11-11.json), with the reproducible [initial-graph collector](artifacts/phase1-voice-r10-initial-collector.mjs). Exact R9 plus the two production files compiled, passed TypeScript and prerendered first try. All 5,449 unaffected source inputs and 3,263 public files remain identical; R8 press is excluded.

The supplemental common initial entry graph falls from 420,663 to **417,476 gzip bytes** (3,187 saved); Jobs falls from 466,695 to **465,081** (1,614 saved). The facade falls from 21,699 to 4,718 pre-minify bytes, while the 18,009-byte engine and 2,121-byte audio helper are absent from both initial graphs. Module attribution is not additive compressed savings; the entry-map measurement remains distinct from the formal reference-union metric and a real browser request trace.

Unchanged formal byte metrics: shared **473,958**, heaviest **749,234**, Phase0-relative changed deployment **1,271,639** gzip bytes. All three Phase0 regression ratchets pass. Final 120,000 shared / 180,000 heaviest targets remain unmet. R9→R10 changes 25/284 scripts (259 reused), **157,682 gzip bytes**, so the strict **100,000-byte target fails**. This optional split does not solve shared-hook/module-copy churn.

No HTTP server, startup/journey capture, idle observation, field-phone check or activation ran. Full release evidence remains required for a combined candidate; existing failed performance gates are unchanged.
