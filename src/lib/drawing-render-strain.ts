/**
 * Watches frame pacing during camera motion. Some devices miss a frame each
 * time a new detail bitmap is drawn or composited; there, detail is refilled
 * only when the view needs it, not ahead of where it is heading.
 */
export type DrawingRenderStrain = {
  /** Call once per animation frame while the camera moves. */
  frame: (at: number, rendering: boolean) => void;
  readonly strained: boolean;
};

/** Frames per verdict. */
const WINDOW = 40;

export function createDrawingRenderStrain(): DrawingRenderStrain {
  let last = Number.NEGATIVE_INFINITY;
  // Display refresh period, from the shortest recent frame. Follows a lower
  // rate (power saving) slowly.
  let period = Number.POSITIVE_INFINITY;
  const busy = { frames: 0, late: 0 };
  const idle = { frames: 0, late: 0, rate: 0 };
  let strained = false;
  // Verdicts in a row that blamed rendering.
  let blamed = 0;
  return {
    get strained() {
      return strained;
    },
    frame(at, rendering) {
      const interval = at - last;
      last = at;
      // A pause between gestures says nothing about rendering.
      if (!(interval > 0) || interval > 100) return;
      period =
        interval < period ? interval : period + (interval - period) * 0.05;
      const late = interval > period * 1.6 ? 1 : 0;
      const counts = rendering ? busy : idle;
      counts.frames++;
      counts.late += late;
      if (idle.frames >= WINDOW) {
        idle.rate = idle.late / idle.frames;
        idle.frames = idle.late = 0;
      }
      if (busy.frames < WINDOW) return;
      const rate = busy.late / busy.frames;
      busy.frames = busy.late = 0;
      // Only frames missed because of rendering count; a page that is slow
      // anyway is not helped by drawing less. A couple of hitches can fall in
      // one window by chance; a device that misses frames for each bitmap
      // does so window after window.
      if (rate >= 0.05 && rate > idle.rate + 0.03) {
        blamed++;
        if (blamed >= 2) strained = true;
      } else {
        blamed = 0;
        if (rate < 0.025) strained = false;
      }
    },
  };
}
