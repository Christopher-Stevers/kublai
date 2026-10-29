import {
  wheelHubRadius,
  WHEEL_CHOICE_DIAMETER,
  type WheelBounds,
} from "./quick-wheel-layout";
import { thumbClearance, type WheelHand } from "./quick-wheel-hand";

type Point = { x: number; y: number };
export const wrapWheelIndex = (index: number, count: number) =>
  ((index % count) + count) % count;

/** Approximate one CSS inch above the visible bottom, fixed for the gesture. */
export function wheelThumbAnchor(
  viewport: WheelBounds,
  hand: WheelHand,
): Point {
  return {
    x: hand === "right" ? viewport.right : viewport.left,
    y: Math.max(viewport.top, viewport.bottom - 96),
  };
}

/** Neutral continues from the thumb-side anchor through the hub, away from the hand. */
export function wheelJoystickAxes(origin: Point, anchor: Point) {
  const dx = origin.x - anchor.x,
    dy = origin.y - anchor.y;
  const length = Math.hypot(dx, dy);
  const inward =
    length < 8 ? { x: 0, y: -1 } : { x: dx / length, y: dy / length };
  return { inward, sideways: { x: -inward.y, y: inward.x } };
}
export function wheelJoystickMotion(
  origin: Point,
  pointer: Point,
  anchor: Point,
  radius: number,
  dragging = false,
) {
  const { inward, sideways } = wheelJoystickAxes(origin, anchor);
  const dx = pointer.x - origin.x,
    dy = pointer.y - origin.y;
  const forward = dx * inward.x + dy * inward.y;
  const lateral = dx * sideways.x + dy * sideways.y;
  // Pulling back moves the wheel; it must never arm an item or rotate it.
  const relocate = dragging
    ? forward <= 0
    : forward < -8 && -forward >= Math.abs(lateral);
  return {
    relocate,
    speed: relocate ? 0 : wheelJoystickSpeed(lateral, forward, radius),
  };
}

/** Only the hub is a joystick. Outside it the pointer belongs to selection. */
export function wheelJoystickSpeed(dx: number, dy: number, radius: number) {
  const hub = wheelHubRadius(radius);
  if (Math.hypot(dx, dy) > hub || Math.abs(dx) <= 8) return 0;
  // A steady deflection keeps browsing; returning to centre stops immediately.
  const strength = Math.min(1, (Math.abs(dx) - 8) / Math.max(1, hub - 8));
  return Math.sign(dx) * (0.45 + 3.05 * strength * strength);
}

export type WheelArc = { radius: number; start: number; step: number };
const onArc = (origin: Point, arc: WheelArc, position: number): Point => ({
  x: origin.x + Math.sin(arc.start + position * arc.step) * arc.radius,
  y: origin.y - Math.cos(arc.start + position * arc.step) * arc.radius,
});

/** Find one continuous rail, rather than moving between concentric thumb fans.
 * Sample the entire rail so interpolated positions fit as well as resting tiles.
 * Computed once per origin; animation only evaluates sine/cosine for visible tiles.
 */
export function joystickWheelArc(
  origin: Point,
  bounds: WheelBounds,
  radius: number,
  count: number,
  hand: WheelHand,
  anchor?: Point,
) {
  const padding = WHEEL_CHOICE_DIAMETER / 2;
  const inward = anchor ? wheelJoystickAxes(origin, anchor).inward : undefined;
  const away = inward
    ? Math.atan2(inward.x, -inward.y)
    : hand === "right"
      ? -Math.PI / 4
      : Math.PI / 4;
  const angularDistance = (a: number, b: number) =>
    Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  for (
    let capacity = Math.min(6, count);
    capacity >= Math.min(2, count);
    capacity--
  ) {
    let best: { points: Point[]; arc: WheelArc; score: number } | undefined;
    for (
      let r = wheelHubRadius(radius) + padding + 18;
      r <=
      Math.min(
        420,
        Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top),
      );
      r += 16
    ) {
      const step = 2 * Math.asin((WHEEL_CHOICE_DIAMETER + 14) / (2 * r));
      for (let degree = -180; degree < 180; degree += 5) {
        const arc = { radius: r, start: (degree * Math.PI) / 180, step };
        const middle = arc.start + (step * (capacity - 1)) / 2;
        const score = r + angularDistance(middle, away) * 50;
        if (best && score >= best.score) continue;
        const samples = Array.from(
          { length: Math.max(1, (capacity - 1) * 8 + 1) },
          (_, i) => onArc(origin, arc, i / 8),
        );
        if (
          !samples.every(
            (p) =>
              (!inward ||
                (p.x - origin.x) * inward.x + (p.y - origin.y) * inward.y >=
                  0) &&
              p.x >= bounds.left + padding &&
              p.x <= bounds.right - padding &&
              p.y >= bounds.top + 52 + padding &&
              p.y <= bounds.bottom - padding &&
              thumbClearance(p.x, p.y, origin.x, origin.y, hand) >=
                padding + 38,
          )
        )
          continue;
        best = {
          arc,
          score,
          points: Array.from({ length: capacity }, (_, i) =>
            onArc(origin, arc, i),
          ),
        };
      }
    }
    if (best) return best;
  }
  return undefined;
}

export type CarouselTile = Point & {
  key: number;
  index: number;
  opacity: number;
};
const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** A bounded window into an endless list; never render the entire catalogue. */
export function wheelCarousel(
  offset: number,
  count: number,
  points: Point[],
  origin: Point,
  circular: boolean,
  arc?: WheelArc,
): CarouselTile[] {
  if (!count || !points.length) return [];
  const capacity = points.length;
  // A thumb arc has a hidden gap at its hub even for a short list.
  const overflowing = count > capacity || Boolean(arc);
  const period = arc && count <= capacity ? count + 1 : count;
  const base = Math.floor(offset);
  const fraction = offset - base;
  const tiles: CarouselTile[] = [];
  for (
    let slot = overflowing ? -1 : 0;
    slot < capacity + (overflowing ? 1 : 0);
    slot++
  ) {
    const position = slot - fraction;
    const key = base + slot;
    const index = wrapWheelIndex(key, period);
    if (index >= count) continue;
    let point: Point;
    let opacity = 1;
    if (overflowing && (position < 0 || position > capacity - 1)) {
      const entrance = position < 0;
      const progress = entrance ? position + 1 : capacity - position;
      if (progress <= 0) continue;
      // Fade into the hub before loading/unloading, leaving digits and labels
      // fully opaque everywhere a user can select them.
      opacity = progress * progress * (3 - 2 * progress);
      point = lerp(origin, points[entrance ? 0 : capacity - 1]!, progress);
    } else if (arc) {
      point = onArc(origin, arc, position);
    } else if (circular) {
      const ring = Math.hypot(points[0]!.x - origin.x, points[0]!.y - origin.y);
      const angle = (position * Math.PI * 2) / capacity;
      point = {
        x: origin.x + Math.sin(angle) * ring,
        y: origin.y - Math.cos(angle) * ring,
      };
    } else {
      const lower = Math.floor(position);
      point = lerp(
        points[wrapWheelIndex(lower, capacity)]!,
        points[wrapWheelIndex(lower + 1, capacity)]!,
        position - lower,
      );
    }
    tiles.push({ ...point, key, index, opacity });
  }
  return tiles;
}
