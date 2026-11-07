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
