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
  | { kind: "curved"; choices: CurvedChoice[]; deadZoneRadius: number };
// A short, deliberate slide should arm a choice, even inside the feedback hub.
export const wheelDeadZoneRadius = (radius: number) => (radius * 32) / 170;
export const WHEEL_CHOICE_DIAMETER = 104;
export const wheelChoiceRingRadius = (radius: number) =>
  Math.min((radius * 138) / 170, radius - WHEEL_CHOICE_DIAMETER / 2);

export const wheelVisibleLimit = (bounds: WheelBounds) =>
  bounds.bottom - bounds.top >= 260 && bounds.right - bounds.left < 350 ? 4 : 6;

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

/** The edge shape is a continuous curved fan, with its tip fixed to the finger. */
export function quickWheelLayout(
  x: number,
  y: number,
  radius: number,
  count: number,
  bounds: WheelBounds,
): WheelLayout {
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
