# Initial validation - 2026-09-24 UTC

These are **known-seed functional-room** measurements on generated ResPlan drawings at
1024-pixel width. They are not end-to-end construction-PDF or whole-suite accuracy claims.
No holdout examples were run. The live app and production data were not changed.

## Smoke sweep: 12 fixed cases / 84 reference rooms

| Configuration | F1 @ IoU .50 | Recall @ .50 | F1 @ .75 |
|---|---:|---:|---:|
| sealed-components | 0.9375 | 0.8929 | 0.8750 |
| opus-doorway-growth | 0.9500 | 0.9048 | 0.8875 |
| wider-seals | 0.9250 | 0.8810 | 0.8625 |

Each fresh configuration took approximately 10 seconds on this machine. Cached repeats
were approximately 2 seconds per configuration, including scoring and review images.
The sweep created paired comparison pages that show the specific regressions/improvements.

## Development: 200 cases / 1,331 reference rooms

`opus-doorway-growth`:

- 1,153 matches; 178 unmatched reference rooms; 9 extra predictions at IoU >= .50.
- F1 @ .50: 0.92499; recall: 0.86627; F1 @ .75: 0.85199.
- 160 potential merge flags; no split flags under the documented thresholds.
- No execution failures.
- First development pass: 155.6 seconds, with 12 smoke predictions already cached.
- Repeat: 34.6 seconds, all 200 predictions cached, exactly identical quality metrics.

Real-world correctness is not established by these numbers. Many unresolved seeds share
one connected region; these cases are visible in the report and are a useful next diagnosis.

## Harness checks

- 17 Python tests passed, including matching, missing/merged/split objects, holes, invalid
  data, split isolation, comparison rejection, cache invalidation and cache corruption.
- TypeScript `pnpm exec tsc --noEmit` passed.
- Deliberately forced a 1 ms timeout: all 12 cases reported timeout, all 84 reference rooms
  counted as missed, F1=0, run marked unranked, and CLI exited 1.
- Browser inspection verified leaderboard, run links, expandable per-case reviews, and
  rendered input/reference/prediction panels.
- Source/config snapshots, hashes and complete per-case results are in each run directory.

Current local output: `/home/tim/datasets/foremanhq-room-detection/experiments/index.html`.
Latest full recorded repeat: `20260924T032457-0c6578`.
