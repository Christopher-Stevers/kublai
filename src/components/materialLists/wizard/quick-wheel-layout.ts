import { thumbClearance, type WheelHand } from "./quick-wheel-hand";
export type WheelBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
type Point = { x: number; y: number };
export type CurvedChoice = { path: string; polygon: Point[]; label: Point };
export type WheelLayout =
  | { kind: "circle" }
  | {
      kind: "curved";
      choices: CurvedChoice[];
      deadZoneRadius: number;
      labelsOnly?: boolean;
      /** Line joining the choices, when they don't sit on a single arc. */
      track?: string;
    };
// A short, deliberate slide should arm a choice, even inside the feedback hub.
export const wheelDeadZoneRadius = (radius: number) => (radius * 32) / 170;
export const WHEEL_CHOICE_DIAMETER = 104;
export const wheelChoiceRingRadius = (radius: number) =>
  Math.min((radius * 138) / 170, radius - WHEEL_CHOICE_DIAMETER / 2);
/** The feedback circle under the finger. */
export const wheelHubRadius = (radius: number) => (radius * 64) / 170;

type Origin = { x: number; y: number; radius: number };
export const wheelVisibleLimit = (
  bounds: WheelBounds,
  hand?: WheelHand,
  origin?: Origin,
) =>
  hand && origin
    ? // As many as fit clear of the thumb, between three and six.
      Math.max(
        3,
        thumbFan(origin.x, origin.y, origin.radius, 6, bounds, hand).length,
      )
    : bounds.bottom - bounds.top >= 260 && bounds.right - bounds.left < 350
      ? 4
      : 6;

// Clockwise from straight up, as on the round wheel.
const pointAt = (x: number, y: number, angle: number, r: number) => ({
  x: x + Math.sin(angle) * r,
  y: y - Math.cos(angle) * r,
});
const turn = (angle: number) => {
  const a = (((angle % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return Math.abs(a);
};
function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = clamp(
    ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy),
    0,
    1,
  );
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
type FanSlot = Point & { ring: number; angle: number };

/**
 * Up to `count` slots on rings around the finger, filled from the inner ring
 * outward and centred on the side away from the thumb. No slot sits under the
 * thumb, over the hub, under the title, or in the straight slide to another.
 */
function thumbFan(
  x: number,
  y: number,
  radius: number,
  count: number,
  bounds: WheelBounds,
  hand: WheelHand,
): FanSlot[] {
  const padding = WHEEL_CHOICE_DIAMETER / 2;
  const gap = WHEEL_CHOICE_DIAMETER + 12;
  const away = ((hand === "right" ? -1 : 1) * Math.PI) / 4;
  const first = Math.max(
    wheelChoiceRingRadius(radius),
    wheelHubRadius(radius) + padding + 18,
  );
  const top = bounds.top + 52;
  const candidates: (FanSlot & { score: number })[] = [];
  // Rings closer than a tile apart; the spacing check staggers them.
  for (let ring = 0; ring < 6; ring++) {
    const r = first + ring * gap * 0.8;
    for (let degree = 0; degree < 360; degree += 3) {
      const angle = (degree * Math.PI) / 180;
      const point = pointAt(x, y, angle, r);
      if (
        point.x - padding < bounds.left ||
        point.x + padding > bounds.right ||
        point.y - padding < top ||
        point.y + padding > bounds.bottom ||
        thumbClearance(point.x, point.y, x, y, hand) < padding + 38
      )
        continue;
      candidates.push({
        ...point,
        ring: r,
        angle,
        score: ring * 10 + turn(angle - away),
      });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  const chosen: FanSlot[] = [];
  for (const slot of candidates) {
    if (chosen.length === count) break;
    if (
      chosen.some(
        (other) =>
          Math.hypot(other.x - slot.x, other.y - slot.y) < gap ||
          (other.ring < slot.ring &&
            distanceToSegment(other, { x, y }, slot) < padding + 6),
      )
    )
      continue;
    chosen.push(slot);
  }
  return chosen;
}

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

/** The edge shape is a continuous curved fan, with its tip fixed to the finger. */
export function quickWheelLayout(
  x: number,
  y: number,
  radius: number,
  count: number,
  bounds: WheelBounds,
  hand?: WheelHand,
): WheelLayout {
  if (hand) {
    const slots = thumbFan(x, y, radius, count, bounds, hand);
    if (slots.length === count) {
      // Order round the free side, starting just past the thumb, so the track
      // along each ring never crosses the thumb or the hub.
      const thumb = ((hand === "right" ? 1 : -1) * Math.PI * 4) / 5;
      const around = (slot: FanSlot) =>
        (((slot.angle - thumb) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      slots.sort((a, b) => a.ring - b.ring || around(a) - around(b));
      // One rail per ring, from its first tile to its last.
      const track = [...new Set(slots.map((slot) => slot.ring))]
        .map((ring) => {
          const onRing = slots.filter((slot) => slot.ring === ring);
          if (onRing.length < 2) return "";
          const from = onRing[0]!,
            to = onRing.at(-1)!;
          const large = around(to) - around(from) > Math.PI ? 1 : 0;
          return `M${from.x} ${from.y}A${ring} ${ring} 0 ${large} 1 ${to.x} ${to.y}`;
        })
        .join("");
      return {
        kind: "curved",
        deadZoneRadius: wheelDeadZoneRadius(radius),
        labelsOnly: true,
        track,
        choices: slots.map(({ x, y }) => ({
          label: { x, y },
          polygon: [],
          path: "",
        })),
      };
    }
  }

  if (
    x - radius >= bounds.left &&
    x + radius <= bounds.right &&
    y - radius >= bounds.top &&
    y + radius <= bounds.bottom &&
    (count <= 1 ||
      2 * wheelChoiceRingRadius(radius) * Math.sin(Math.PI / count) >=
        WHEEL_CHOICE_DIAMETER + 8)
  )
    return { kind: "circle" };
  // A short landscape viewport has room for a horizontal row of full-size circles.
  if (bounds.bottom - bounds.top < 260) {
    const step = (bounds.right - bounds.left) / count;
    const middle = (bounds.top + bounds.bottom) / 2;
    return {
      kind: "curved",
      deadZoneRadius: wheelDeadZoneRadius(radius),
      choices: Array.from({ length: count }, (_, index) => {
        const left = bounds.left + index * step;
        const right = left + step;
        const polygon = [
          { x: left, y: bounds.top },
          { x: right, y: bounds.top },
          { x: right, y: bounds.bottom },
          { x: left, y: bounds.bottom },
        ];
        return {
          label: { x: (left + right) / 2, y: middle },
          polygon,
          path: `M ${left},${bounds.top} H ${right} V ${bounds.bottom} H ${left} Z`,
        };
      }),
    };
  }
  // Spread larger circles over a taller arc and reserve their full radius at edges.
  const padding = WHEEL_CHOICE_DIAMETER / 2;
  const expandedRadius = radius * 1.7;
  const rx = Math.min(
    expandedRadius * (bounds.bottom - bounds.top < 260 ? 1.3 : 1),
    (bounds.right - bounds.left) / 2 - padding,
  );
  const ry = Math.min(
    expandedRadius,
    (bounds.bottom - bounds.top) / 2 - padding,
  );
  const cx = clamp(x, bounds.left + padding + rx, bounds.right - padding - rx);
  const cy = clamp(y, bounds.top + padding + ry, bounds.bottom - padding - ry);
  const dx = (x - cx) / rx,
    dy = (y - cy) / ry;
  const distance = Math.hypot(dx, dy);
  const facing = Math.atan2(dy, dx);
  // Remove the rim facing the finger. The remaining arc swells inward, instead
  // of squeezing labels against the edge. At corners its contour is a teardrop.
  const cut = Math.max(
    Math.PI / 3,
    distance > 1 ? Math.acos(1 / distance) : Math.PI / 3,
  );
  const start = facing + cut,
    span = Math.PI * 2 - cut * 2;
  const rim = (angle: number): Point => ({
    x: cx + Math.cos(angle) * rx,
    y: cy + Math.sin(angle) * ry,
  });
  // Equal arc-length slices keep labels apart on the stretched outline.
  const arc = Array.from({ length: 401 }, (_, n) =>
    rim(start + (span * n) / 400),
  );
  const lengths = [0];
  for (let n = 1; n < arc.length; n++)
    lengths.push(
      lengths[n - 1]! +
        Math.hypot(arc[n]!.x - arc[n - 1]!.x, arc[n]!.y - arc[n - 1]!.y),
    );
  const angleAt = (fraction: number) => {
    const target = lengths.at(-1)! * fraction;
    const index = Math.max(
      1,
      lengths.findIndex((length) => length >= target),
    );
    const t =
      (target - lengths[index - 1]!) / (lengths[index]! - lengths[index - 1]!);
    return start + (span * (index - 1 + t)) / 400;
  };
  const deadZoneRadius = wheelDeadZoneRadius(radius);
  const inner = (point: Point): Point => {
    const length = Math.hypot(point.x - x, point.y - y);
    return {
      x: x + ((point.x - x) * deadZoneRadius) / length,
      y: y + ((point.y - y) * deadZoneRadius) / length,
    };
  };
  const coords = (point: Point) => `${point.x},${point.y}`;
  return {
    kind: "curved",
    deadZoneRadius,
    choices: Array.from({ length: count }, (_, index) => {
      const a = angleAt(index / count) + 0.012;
      const b = angleAt((index + 1) / count) - 0.012;
      const first = rim(a),
        last = rim(b),
        mid = rim(angleAt((index + 0.5) / count));
      const i = inner(first),
        j = inner(last);
      const polygon = [
        i,
        ...Array.from({ length: 25 }, (_, n) => rim(a + ((b - a) * n) / 24)),
        j,
      ];
      return {
        path: `M ${coords(i)} L ${coords(first)} A ${rx} ${ry} 0 ${b - a > Math.PI ? 1 : 0} 1 ${coords(last)} L ${coords(j)} Q ${x},${y} ${coords(i)} Z`,
        polygon,
        label: { x: x + (mid.x - x) * 0.88, y: y + (mid.y - y) * 0.88 },
      };
    }),
  };
}

export function curvedChoiceAt(
  layout: Extract<WheelLayout, { kind: "curved" }>,
  x: number,
  y: number,
  originX: number,
  originY: number,
) {
  if (Math.hypot(x - originX, y - originY) <= layout.deadZoneRadius)
    return null;
  // Labels are part of their wedge, including the small rim overhang.
  const label = layout.choices.findIndex(
    (choice) =>
      Math.hypot(x - choice.label.x, y - choice.label.y) <=
      WHEEL_CHOICE_DIAMETER / 2,
  );
  if (label >= 0) return label;
  if (layout.labelsOnly) return null;
  const index = layout.choices.findIndex(({ polygon }) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i]!,
        b = polygon[j]!;
      if (
        a.y > y !== b.y > y &&
        x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
      )
        inside = !inside;
    }
    return inside;
  });
  return index < 0 ? null : index;
}
