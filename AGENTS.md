# ForemenHQ project instructions

## TypeSafe / Jev

Use the project-local TypeSafe skill at `.agents/skills/typesafe-ai/SKILL.md` when working on Jev integrations or AI-assisted features in ForemenHQ. Read its instructions and the relevant current TypeSafe documentation before changing those integrations.

The integration and setup notes are in `docs/JEV_ASSISTANCE.md`. Keep API keys server-side. Provider tests use simulated responses until a TypeSafe key is configured; do not describe those tests as proof of live model accuracy.

## Room-detection collaboration

Tim requested a shared research notebook for the agents working on room detection.
On the Omarchy development machine, read and append dated, attributed findings to
`/home/tim/Documents/Codex/ROOM_DETECTION_SHARED_NOTES.md`; preserve other entries.
Check current source and deployment state before relying on historical notes.
Keep experimental proposals separate from verified room annotations, and record
whether an evaluation targets individual physical rooms or suites/common spaces.
Do not treat generated illustrations or unreviewed model output as an answer key.
The notebook does not imply that another agent has received or read an entry.

## Performance plan and releases

Tim authorized `/home/tim/.openclaw/worktrees/foremanhq-ui/SPEED_PLAN.md` on
2026-11-10. Follow its phase order and measured gates. The implementation and
remaining evidence are recorded in `perf/README.md` and `perf/STATUS.md`.

- Use `scripts/release/build.mjs` and the instructions in
  `scripts/release/README.md` for production builds, including Codex sessions.
  Do not switch between webpack/Turbopack or invent per-session build recipes.
- Preserve scripts from at least the last ten builds; serve precompressed Brotli
  where supported. A failed speed gate blocks activation, not just the report.
- After the measurement bootstrap, activate web candidates with
  `scripts/release/activate.mjs` and the complete matching evidence described in
  `scripts/release/ACTIVATION.md`. Do not manually switch around a failed preflight.
- Run write journeys only against the disposable `perf/lab/database.sh` database.
  Never point the lab at the production database or deploy a `PERF_LAB_ONLY` build.
- Record measurements and missing evidence separately. Do not equate simulated
  tests with field-phone, Safari, offline-convergence or drawing-quality passes.
- Tim approved reading 50–100 production sheets for the drawing spike and a Rust
  toolchain in his home folder. Production drawings are read-only during the spike.
- Wait for sign-in confirmation before painting a saved private screen. The
  pre-auth last-screen shortcut was explicitly declined.
- Ask for each production database change and the receiving worker release when
  those steps are reached. No schema or worker change is part of phases 0–1.
