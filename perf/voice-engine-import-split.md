# Optional voice engine import split

The R9 emitted common-entry graph includes the combined `VoiceProvider` module (21,699 pre-minify bytes). This is attribution, not an estimate of transferable gzip savings. The Dev-feature check executes after that module has been imported.

The lightweight context/card now imports the engine through `React.lazy`. Workspace children remain siblings of the engine's Suspense/error boundary, continuously mounted while it loads or retries. The card appears only after the engine has committed its controls and status. Starting from the card still calls the existing microphone-start function synchronously in the user's event. No request, microphone, session, proposal-confirmation or account-key lifecycle logic is changed; engine unmount retains the existing abort/generation/microphone cleanup. The existing parent account/simulation key still destroys the controller.

A failed optional engine import offers local retry without reloading the workspace. Ordinary accounts with Dev features disabled do not mount or request the engine. No model API, server authorization, schema, worker, package or lockfile changes are involved.

Validation: six focused mocked tests pass, including no automatic microphone start, explicit proposal confirmation, hidden-tab pause, unmount cleanup, turning Dev off, and retaining the exact workspace input node/draft through engine loading. Scoped ESLint passes for the three edited/new TSX files. Tests use Node's `--no-experimental-webstorage` so JSDOM supplies localStorage; the first invocation without that flag failed on Node's missing localStorage implementation, not an engine assertion. No live model or microphone is used.

Canonical emitted-byte evidence is pending. Final shared/heaviest targets, the unchanged 100,000-byte changed-script target and applicable release gates remain in force. This slice has not been activated.
