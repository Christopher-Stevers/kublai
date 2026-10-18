# Super scale

Drawing viewer → More → Super scale. Available online to drawing managers on the current drawing revision. Save pending sheet details first.

1. Open Super scale. Its first prompt starts a fresh Set Scale calibration: mark two points on known grid lines and enter their real distance. Canceling or a failed save does not continue.
2. After the calibration saves, choose two parallel named grids. The preview highlights their actual vectors; the known separation comes from the reference calibration.
3. Find matching drawings in the same job. Review matches and apply the selected results.

The reference distance is transferred, not its sheet-width scale factor. Each target derives its own units per sheet width. Existing calibrations are kept. Normal metadata permissions, revision checks, and activity recording apply to every save. Partial failures are reported per drawing; a changed reference blocks applying the scan. Changing either chosen grid clears prior results.

## Detection and limits

No AI calls. Text positions, circular grid bubbles (including polygon approximations), and axis-aligned vector strokes establish named grid candidates. Collinear CAD dash fragments are joined only across small gaps. Duplicate labels at different positions are excluded. Additional same-axis grid spacing must agree within 2.5% of the reference pair's spacing; disagreement rejects a match. A pair without extra checks is shown unchecked for explicit inspection. Additional checks establish geometric consistency, not building identity; users still inspect the results.

The PDF reader is separate from the visible viewer's cache, holds one PDF at a time, cleans parsed pages, and closes on cancellation. This avoids evicting the visible drawing during a job-wide scan.

Scans, angled/curved grids, obscured labels, detached grid headers, and vector extraction limits are not automatically calibrated. A page with independently scaled details cannot be assigned multiple scales by this feature. It does not overwrite calibrated sheets, monitor later uploads, or propagate future recalibrations automatically. No drawing scales change until Apply.

## Validation (2026-10-17)

Sampled actual architectural and mechanical PDFs produced named grid candidates. A browser workflow on mechanical pages M-103 and M-105 matched grids 1.01 and 1.13 with 18 additional spacing checks, previewed the source and target, and exercised a simulated save. This is not evidence that every sheet in the project can be calibrated. Production catalogue/drawing data was not altered by these checks.
