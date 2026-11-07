# Foreman Voice

2026-10-27 implementation. Local LFM3-Audio-2B handles English transcription,
structured action planning, and speech. Inference shares the existing GPU service
at `127.0.0.1:8093`; no OpenAI or Jev credentials are involved.

## User experience

The Jobs list and each job menu have a voice card. A tap requests microphone
permission, starts a session, and lights the card while listening. Speech detection
ends an utterance after a pause, then listening resumes after the response.
This is automatic turn-taking, not simultaneous speaking and listening. The Stop
speaking control interrupts playback. Backgrounding the app pauses the microphone.
The persistent dock supports typed requests, pause/resume, and ending the session.
Uncertain intentions should prompt a question. Ambiguous discovered targets are
checked by the server; follow-ups can use a name or first/second/etc.

## Capabilities and boundaries

- Navigate to global app tabs, account/settings, asset sections, jobs and their
  material lists, drawings, documents, rooms, systems, models, receiving, pricing,
  tool requests and chat; also individual material lists and drawing sheets.
- Search jobs, catalogue parts, lists, orders, rooms, documents, drawings, suppliers.
- Inspect list/order items and fulfillment information.
- Prepare job/list creation or renaming, add catalogue parts, change positive draft
  quantities, or append order notes. Each edit needs an explicit screen tap.
- No deletion, removal, archive, cancellation, zeroing quantities, permissions,
  billing, arbitrary URLs, SQL, shell commands, general HTTP, messaging, or order
  sending/marking-sent tool exists. Already-sent list quantities cannot be edited.
- Existing account/company permissions are checked on each request and again on
  confirmation. Documents retain folder ACL checks. Simulation/tutorials cannot
  access live voice actions. No database credentials or app tools reach the model.

Strict schemas validate the model's JSON/native tool format. Names and tool results
are data. UUIDs must be discovered or refer to the current page; ambiguous choices
cannot be silently selected. Early keyword refusals are only a usability layer;
the allowlisted executor is the enforcement boundary. Unrecognized requests ask
for clarification. A small model can still misunderstand language, so previews are
required for all writes and remain human-reviewable before execution.

## Confirmation, storage, operation

Sessions are user/company-bound, in memory, 30 minutes maximum. Preview tokens
expire after two minutes and are single-use. The record fingerprint is checked
inside the same transaction as the change. A later edit invalidates the preview.
Only a separate confirm request can apply it; saying “yes” is another voice turn.
Writes reuse the existing material mutation validation, recalculation and sync.
Audit events (user/company, change/summary, requested/saved/failed) are written to
`.private/voice/actions.jsonl` with owner-only file permissions. Audio isn't saved;
conversation/choice state expires with the session or server restart.

`src/server/voice/provider.ts` reads the existing service key from
`LFM_VOICE_KEY_FILE` or `/home/tim/Projects/lfm3-voice/access-key`, server-side only.
The versioned private inference bridge is `scripts/voice/foreman_bridge.py`.
The running service imports `install(app, state, lock, KEY)` from that module.
Its bounded endpoint requires the key and serializes inference with the existing
model lock. The bridge has no app-action/database integration of its own.

To update the bridge, copy this file into the existing LFM service directory and
restart `lfm3-voice.service`. Check `/health` before app release. This deployment
uses the existing Python environment/model; it does not download another model.
The app returns a busy message if another session is using the GPU.

## Verification

Focused tests cover strict action rejection, tenant/session isolation, preview
expiry/replay, stale record protection, ambiguous choice follow-ups, microphone
lifecycle and click-only confirmation. Live model smoke checks cover ASR/TTS and
structured navigation/creation against fixture results; these are not a general
accuracy benchmark. Browser checks use the real component and simulated API
responses, so microphone permission/device behavior still warrants iPad review.
