type Point = { x: number; y: number };

// CSS pixels per millisecond: separate entry/exit speeds prevent finger tremor
// from repeatedly switching between fine and direct movement.
const SLOW_SPEED = 0.08;
const FAST_SPEED = 0.3;
const SLOW_DWELL_MS = 120;
// Previously gained 3× in 600 ms. Keep the rate independent of the ceiling:
// one third of that speed gains 1× per 600 ms, reaching 8× in 4.2 seconds.
const ZOOM_PER_MS = 1 / 600;
export const MAX_MEASURE_PRECISION_ZOOM = 8;

export type MeasurePrecision = {
  finger: Point;
  aim: Point;
  /** Additional magnification over the normal loupe, and inverse movement gain. */
  zoom: number;
  speed: number;
  sampledAt: number;
  updatedAt: number;
  slowSince: number | null;
};

export function beginMeasurePrecision(
  finger: Point,
  now: number,
  aim = finger,
): MeasurePrecision {
  return {
    finger,
    aim,
    zoom: 1,
    speed: 0,
    sampledAt: now,
    updatedAt: now,
    slowSince: now,
  };
}

function restingSpeed(state: MeasurePrecision, now: number) {
  // Pointer events stop when the finger rests. Age the last speed so a pause
  // still starts precision zoom, without requiring another pointer event.
  return state.speed * Math.exp(-Math.max(0, now - state.sampledAt - 50) / 80);
}

export function advanceMeasurePrecision(
  state: MeasurePrecision,
  now: number,
): MeasurePrecision {
  const slowSince =
    restingSpeed(state, now) <= SLOW_SPEED ? (state.slowSince ?? now) : null;
  const elapsed = Math.max(0, Math.min(now - state.updatedAt, 64));
  const zoom =
    slowSince !== null && now - slowSince >= SLOW_DWELL_MS
      ? Math.min(
          MAX_MEASURE_PRECISION_ZOOM,
          state.zoom + elapsed * ZOOM_PER_MS,
        )
      : state.zoom;
  // Only magnification changes during a pause; the target never drifts.
  return { ...state, zoom, slowSince, updatedAt: now };
}

export function moveMeasurePrecision(
  state: MeasurePrecision,
  finger: Point,
  now: number,
): MeasurePrecision {
  const next = advanceMeasurePrecision(state, now);
  const dx = finger.x - state.finger.x;
  const dy = finger.y - state.finger.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return next;
  // Don't average a new quick movement over a long stationary hold. Conversely,
  // coalesced events only a millisecond apart must not amplify sensor noise.
  const elapsed = Math.max(8, Math.min(now - state.sampledAt, 64));
  const instant = distance / elapsed;
  const weight = 1 - Math.exp(-elapsed / 60);
  const speed = restingSpeed(state, now) * (1 - weight) + instant * weight;
  const fast = speed >= FAST_SPEED || (distance >= 8 && instant >= FAST_SPEED);
  const zoom = fast ? 1 : next.zoom;
  const aim =
    zoom === 1
      ? finger
      : { x: state.aim.x + dx / zoom, y: state.aim.y + dy / zoom };
  return {
    ...next,
    finger,
    aim,
    zoom,
    speed,
    sampledAt: now,
    slowSince: fast || speed > SLOW_SPEED ? null : (next.slowSince ?? now),
  };
}
