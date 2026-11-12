# Plan change: deploy to dev first, review after

From Tim, 2026-11-12. Written up by the Claude session on `claude/bottom-bar-standard`. For Astra, who owns the speed plan and the release gate.

## The change in one line

Changes go live on dev (the Omarchy machine) as soon as they are built and healthy. The measured gate stops being a door in front of dev. It becomes a review that runs afterwards on a queue of what was deployed.

## Why

Since the gate went in, almost nothing has reached the app. Six candidates were rejected, and one unchanged build failed against itself. Tim builds by trying things on the real app, the same day. A gate in front of dev stops that. Tim still wants the measurements and the improvements they drive. They should follow the work, not block it.

## What this replaces

- In `perf/SPEED_PLAN.md`, Workstream 7 and section 14: wherever the lab gate must pass before activation, read "before promotion to production" in place of "before activation on dev".
- In `scripts/release/ACTIVATION.md`: `activate.mjs` blocking on timing and byte gates no longer applies to dev deploys.
- The fast lane is no longer needed. Every change takes the dev lane.

## The dev lane

**Who may use it.** Any agent working for Tim: Claude sessions, Codex, Astra.

**What must be true before a dev deploy.** Only checks that take minutes:

1. The change is committed and merged to `tim-development`.
2. Its own tests and type check pass on the files it touched.
3. The canonical build succeeds. Keep the one build recipe and the kept files from earlier builds, so a phone holding an old page does not break.
4. One deploy at a time. A lock, so two agents cannot switch builds at once.

**What the deploy does.**

1. Switch to the new build and restart only `foremenhq.service`.
2. Check health: sign-in page answers, a protected endpoint refuses, changed scripts are served.
3. If health fails, switch back by itself and say so.
4. Write one entry in the review queue.

**What it does not do.** No timing matrix, no baseline pair, no byte ratchet, no waiting for a quiet machine.

**Lab runs and dev deploys.** A dev deploy has priority. If a timing run is in progress, the run is paused or marked spoiled and repeated later. The deploy does not wait for it.

## Still needs Tim's explicit OK, every time

Dev uses the real database and the real uploads. So these stay outside the dev lane:

- Any database migration or schema change.
- Any worker bundle release.
- Turning on slip autopilot for an organization.
- Deleting data or files.

## The review queue

One file in the repo, `perf/REVIEW_QUEUE.md`, newest first. The deploy tool writes the entry, so nothing is deployed without one.

Each entry holds:

- Date and time, and which agent deployed.
- Commits included, with one line on what changed for the user.
- Build ID, and the build it replaced.
- Flags: touches worker code, touches shared scripts, large change.
- Review status: waiting, reviewed with no finding, reviewed with findings.

## The review, after the fact

Astra works through the queue in batches, when the machine is free.

- **Measure the batch**, not each change. Compare the current dev build with the last reviewed build, using the same journeys and byte budgets as today.
- **A finding becomes a task**, with the entry it traces to. It does not roll dev back.
- **Tim is told at once only for a serious finding.** Proposed line: a journey more than 25% slower, confirmed on a second run, or a broken journey. Tim decides whether to roll back.
- **The baseline moves forward** to the reviewed build after each batch, so the next batch is compared with what is really running.
- **Measurement fixes continue.** The calibration work on sample counts and frame-sized noise stays in the plan. It now improves the review, not a blocker.

## Promotion to production

The full gate stays as the door in front of production. A build is promoted only from a reviewed batch with no open serious finding.

## Asked of Astra

1. Provide the dev deploy command, for example `node scripts/release/dev-deploy.mjs`. It should do the build, the lock, the switch, the health check, the automatic switch back and the queue entry.
2. Create `perf/REVIEW_QUEUE.md` and update `perf/SPEED_PLAN.md`, `scripts/release/README.md` and `ACTIVATION.md` to match.
3. Tell Tim when the command is ready, so the other agents can be told to use it.
4. First entries for the queue, already merged and waiting: the receiving change, commits `4284faaf`, `5ae53190` and `3243df60`. Web only, no database change. It touches `src/lib/receiving-resolution.ts`, which is also worker code; no worker release is asked for.

## Open point for Tim

This note treats the Omarchy machine as dev and a separate host as production. If the Omarchy machine is the only place the app runs today, then every dev deploy is seen by every user at once, and "promotion to production" has no host yet. The dev lane still works that way. Tim should say whether that is intended.
