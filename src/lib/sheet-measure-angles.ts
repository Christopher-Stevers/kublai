import type { SheetPoint } from "./sheet-measure";
import type { SnapSegment } from "./sheet-snap";

type Node = { point: SheetPoint; line: SnapSegment | null };

/** The first segment uses its attached drawing line; later ones use the incoming segment. */
export function measurementAngleReference(nodes: readonly Node[], endIndex: number) {
  const anchorIndex = endIndex === 0 ? 1 : endIndex - 1;
  const anchor = nodes[anchorIndex];
  if (!anchor) return null;
  // When moving the first endpoint, the next unchanged segment is the reference.
  const previous = nodes[endIndex === 0 ? 2 : anchorIndex - 1]?.point;
  const reference = previous && Math.hypot(previous.x - anchor.point.x, previous.y - anchor.point.y) > 1e-9
    ? { x1: previous.x, y1: previous.y, x2: anchor.point.x, y2: anchor.point.y }
    : anchor.line;
  return { anchorIndex, anchor: anchor.point, reference, previous };
}

/** A drafting arc in fitted sheet pixels, with a screen-sized radius and upright label. */
export function measurementAngleArc(
  anchor: SheetPoint,
  end: SheetPoint,
  reference: SnapSegment | null,
  width: number,
  height: number,
  zoom: number,
  previous?: SheetPoint,
) {
  const vertex = { x: anchor.x * width, y: anchor.y * height };
  const dx = (end.x - anchor.x) * width, dy = (end.y - anchor.y) * height;
  const length = Math.hypot(dx, dy);
  if (!(width > 0 && height > 0 && zoom > 0 && length > 1e-6)) return null;
  const heading = Math.atan2(dy, dx);
  let base: number;
  let incomingLength = Infinity;
  if (previous) {
    const px = (previous.x - anchor.x) * width, py = (previous.y - anchor.y) * height;
    incomingLength = Math.hypot(px, py);
    if (incomingLength < 1e-6) return null;
    base = Math.atan2(py, px);
  } else {
    base = reference ? Math.atan2((reference.y2 - reference.y1) * height, (reference.x2 - reference.x1) * width) : 0;
    // A drawing line is undirected. Use its nearer ray for the first segment.
    if (Math.cos(heading - base) < 0) base += Math.PI;
  }
  const sweep = Math.atan2(Math.sin(heading - base), Math.cos(heading - base));
  const degrees = Math.abs(sweep) * 180 / Math.PI;
  if (degrees < 1 || degrees > 179) return null;
  const radius = Math.min(26 / zoom, length * 0.3, incomingLength * 0.3);
  if (radius * zoom < 4) return null;
  const at = (angle: number, distance = radius) => ({ x: vertex.x + Math.cos(angle) * distance, y: vertex.y + Math.sin(angle) * distance });
  const start = at(base), finish = at(base + sweep);
  const label = at(base + sweep / 2, radius + 13 / zoom);
  return {
    vertex, radius, start, finish, label, degrees,
    text: `${Math.round(degrees * 10) / 10}°`,
    path: `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 ${sweep > 0 ? 1 : 0} ${finish.x} ${finish.y}`,
    // Show the reference ray when the first point has no incoming measurement.
    referenceEnd: !previous ? at(base, radius + 10 / zoom) : null,
  };
}
