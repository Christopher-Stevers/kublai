import type { PipeSegment } from "./pipe-system";
import type { SheetPoint } from "./sheet-measure";
import { samePipeInk } from "./pipe-dashed-junction";

/** A short branch can stop before the run's centerline while its printed ink
 * still touches. Extend only forward, into the interior of one matching run;
 * never widen the general topology or dashed-gap tolerances. */
export function strokeJunctionAt(
  point: SheetPoint,
  branch: PipeSegment,
  nearby: PipeSegment[],
  aspect: number,
  tolerance: number,
): SheetPoint | null {
  const atStart =
    Math.hypot(point.x - branch.x1, (point.y - branch.y1) * aspect) < 1e-7;
  const dx = point.x - (atStart ? branch.x2 : branch.x1),
    dy = (point.y - (atStart ? branch.y2 : branch.y1)) * aspect,
    length = Math.hypot(dx, dy);
  if (length < Math.max(tolerance * 2, branch.width)) return null;
  const bx = dx / length,
    by = dy / length;
  let answer: SheetPoint | null = null;
  for (const run of nearby) {
    if (run === branch || !samePipeInk(branch, run)) continue;
    const rx = run.x2 - run.x1,
      ry = (run.y2 - run.y1) * aspect,
      rl = Math.hypot(rx, ry);
    if (rl < tolerance * 2 || Math.abs((bx * rx + by * ry) / rl) > 0.95)
      continue;
    const ax = run.x1 - point.x,
      ay = (run.y1 - point.y) * aspect,
      cross = bx * ry - by * rx,
      forward = (ax * ry - ay * rx) / cross,
      along = (ax * by - ay * bx) / cross,
      reach = Math.min(0.0003, (branch.width + run.width) / 2);
    // Both arms must already exist. An isolated dash gap is not a run.
    if (
      forward <= tolerance ||
      forward > reach ||
      along * rl <= reach ||
      (1 - along) * rl <= reach
    )
      continue;
    const contact = {
      x: point.x + bx * forward,
      y: point.y + (by * forward) / aspect,
    };
    if (
      answer &&
      Math.hypot(contact.x - answer.x, (contact.y - answer.y) * aspect) > 1e-7
    )
      return null;
    answer = contact;
  }
  return answer;
}
