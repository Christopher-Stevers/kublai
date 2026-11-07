import type { SnapSegment } from "./sheet-snap";
import type { SheetScale } from "./sheet-measure";

export type GridBubble = { x: number; y: number; rx: number; ry: number };
export type GridLabel = { text: string; x: number; y: number };
export type NamedGrid = {
  name: string;
  axis: "x" | "y";
  position: number;
  line: SnapSegment;
};
export type GridRead = {
  grids: NamedGrid[];
  aspect: number;
  ambiguous: string[];
};
const nameOf = (text: string) => text.trim().toUpperCase();

/** Conservative first pass: long, axis-aligned grid candidates with nearby end labels.
 * Coordinates and distances are in sheet widths, including vertical distances.
 * Repeated labels on distinct lines are ambiguous, never picked by array order.
 */
export function identifyGrids(
  lines: SnapSegment[],
  labels: GridLabel[],
  aspect: number,
  bubbles?: GridBubble[],
): GridRead {
  const found = new Map<string, NamedGrid[]>();
  if (!(aspect > 0)) return { grids: [], aspect, ambiguous: [] };
  const candidates = joinGridDashes(lines, aspect).flatMap<
    Omit<NamedGrid, "name">
  >((line) => {
    const dx = Math.abs(line.x2 - line.x1),
      dy = Math.abs(line.y2 - line.y1) * aspect;
    if (dy > 0.15 && dx < 0.001)
      return [{ line, axis: "x" as const, position: (line.x1 + line.x2) / 2 }];
    if (dx > 0.15 && dy < 0.001)
      return [
        {
          line,
          axis: "y" as const,
          position: ((line.y1 + line.y2) * aspect) / 2,
        },
      ];
    return [];
  });
  for (const label of labels) {
    const name = nameOf(label.text);
    if (
      !/^(?:[A-Z]{1,3}(?:[0-9]{1,2})?|[0-9]{1,3})(?:\.[0-9]{1,2})?$/.test(name)
    )
      continue;
    const bubble = bubbles?.find(
      (b) =>
        Math.abs(label.x - b.x) <= b.rx * 0.65 &&
        Math.abs(label.y - b.y) <= b.ry * 0.65,
    );
    if (bubbles && !bubble) continue;
    const anchor = bubble ?? label;
    const nearby = candidates.filter(({ line, axis, position }) => {
      const cross = axis === "x" ? anchor.x : anchor.y * aspect;
      const along = axis === "x" ? anchor.y * aspect : anchor.x;
      const ends =
        axis === "x"
          ? [line.y1 * aspect, line.y2 * aspect]
          : [line.x1, line.x2];
      return (
        Math.abs(cross - position) <
          (bubble ? Math.min(bubble.rx, bubble.ry * aspect) * 0.4 : 0.007) &&
        Math.min(...ends.map((v) => Math.abs(v - along))) <
          (bubble
            ? Math.max(bubble.rx, bubble.ry * aspect) * 2.5 + 0.003
            : 0.035)
      );
    });
    for (const candidate of nearby) {
      const entries = found.get(name) ?? [];
      if (
        !entries.some(
          (g) =>
            g.axis === candidate.axis &&
            Math.abs(g.position - candidate.position) < 0.003,
        )
      )
        entries.push({ ...candidate, name });
      found.set(name, entries);
    }
  }
  const grids: NamedGrid[] = [],
    ambiguous: string[] = [];
  for (const [name, entries] of found) {
    if (entries.length === 1) grids.push(entries[0]!);
    else ambiguous.push(name);
  }
  grids.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  return { grids, aspect, ambiguous };
}

export function gridSpacing(read: GridRead, first: string, second: string) {
  const a = read.grids.find((g) => g.name === first),
    b = read.grids.find((g) => g.name === second);
  if (!a || !b) return null;
  if (a.axis !== b.axis || a.name === b.name) return null;
  const distance = Math.abs(b.position - a.position);
  return distance > 0.005 ? { a, b, distance } : null;
}

export function transferGridScale(
  source: GridRead,
  target: GridRead,
  first: string,
  second: string,
  scale: SheetScale,
):
  | { ok: false; reason: string }
  | { ok: true; scale: SheetScale; checks: number } {
  const a = gridSpacing(source, first, second),
    b = gridSpacing(target, first, second);
  if (!a || !b) return { ok: false, reason: "Grid pair missing or ambiguous" };
  let checks = 0;
  for (const grid of source.grids) {
    if (grid.axis !== a.a.axis || grid.name === first || grid.name === second)
      continue;
    const other = target.grids.find(
      (g) => g.name === grid.name && g.axis === b.a.axis,
    );
    if (!other) continue;
    const from = (grid.position - a.a.position) / (a.b.position - a.a.position);
    const to = (other.position - b.a.position) / (b.b.position - b.a.position);
    if (Math.abs(from - to) > 0.025)
      return {
        ok: false,
        reason: "Other grid spacing disagrees; check manually",
      };
    checks++;
  }
  const unitsPerSheetWidth =
    (scale.unitsPerSheetWidth * a.distance) / b.distance;
  if (
    !Number.isFinite(unitsPerSheetWidth) ||
    unitsPerSheetWidth <= 0 ||
    unitsPerSheetWidth > 1e9
  )
    return { ok: false, reason: "Invalid scale" };
  return {
    ok: true,
    checks,
    scale: {
      unit: scale.unit,
      unitsPerSheetWidth,
      label: `Super scale · ${first}–${second}`,
    },
  };
}

/** Circular stroked subpaths, excluding tiny dots and large curved geometry. */
export function gridBubble(
  points: { x: number; y: number }[],
  aspect: number,
): GridBubble | null {
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const left = Math.min(...xs),
    right = Math.max(...xs),
    top = Math.min(...ys),
    bottom = Math.max(...ys);
  const width = right - left,
    height = (bottom - top) * aspect;
  if (
    width < 0.003 ||
    width > 0.04 ||
    height < 0.003 ||
    height > 0.04 ||
    width / height < 0.8 ||
    width / height > 1.25
  )
    return null;
  return {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
    rx: width / 2,
    ry: (bottom - top) / 2,
  };
}

/** CAD exports often approximate grid bubbles with short straight strokes.
 * Fit those vertices to a circle and require coverage all around the label.
 * A spatial index avoids a labels × all-vectors scan on large sheets.
 */
export function polygonGridBubbles(
  lines: SnapSegment[],
  labels: GridLabel[],
  aspect: number,
): GridBubble[] {
  const buckets = new Map<string, { x: number; y: number }[]>();
  const cell = 0.025;
  for (const line of lines) {
    const length = Math.hypot(line.x2 - line.x1, (line.y2 - line.y1) * aspect);
    if (length > 0.004 || length < 0.00002) continue;
    for (const p of [
      { x: line.x1, y: line.y1 * aspect },
      { x: line.x2, y: line.y2 * aspect },
    ]) {
      const key = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
      const list = buckets.get(key) ?? [];
      list.push(p);
      buckets.set(key, list);
    }
  }
  const result: GridBubble[] = [];
  for (const label of labels) {
    if (
      !/^(?:[A-Z]{1,3}(?:[0-9]{1,2})?|[0-9]{1,3})(?:\.[0-9]{1,2})?$/.test(
        nameOf(label.text),
      )
    )
      continue;
    const x = label.x,
      y = label.y * aspect,
      bx = Math.floor(x / cell),
      by = Math.floor(y / cell);
    const unique = new Map<string, { x: number; y: number }>();
    for (let i = bx - 1; i <= bx + 1; i++)
      for (let j = by - 1; j <= by + 1; j++)
        for (const p of buckets.get(`${i},${j}`) ?? []) {
          if (Math.hypot(p.x - x, p.y - y) < 0.012)
            unique.set(`${p.x.toFixed(6)},${p.y.toFixed(6)}`, p);
        }
    const pts = [...unique.values()];
    if (pts.length < 16 || pts.length > 300) continue;
    const mx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
    const my = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
    let xx = 0,
      xy = 0,
      yy = 0,
      xr = 0,
      yr = 0;
    for (const p of pts) {
      const dx = p.x - mx,
        dy = p.y - my,
        r = dx * dx + dy * dy;
      xx += dx * dx;
      xy += dx * dy;
      yy += dy * dy;
      xr += (dx * r) / 2;
      yr += (dy * r) / 2;
    }
    const det = xx * yy - xy * xy;
    if (det < 1e-14) continue;
    const cx = mx + (xr * yy - yr * xy) / det,
      cy = my + (yr * xx - xr * xy) / det;
    const radii = pts.map((p) => Math.hypot(p.x - cx, p.y - cy));
    const radius = radii.reduce((a, b) => a + b, 0) / radii.length;
    if (
      radius < 0.002 ||
      radius > 0.01 ||
      Math.hypot(cx - x, cy - y) > radius * 0.6
    )
      continue;
    const error = Math.sqrt(
      radii.reduce((s, r) => s + (r - radius) ** 2, 0) / radii.length,
    );
    if (
      error > radius * 0.055 ||
      radii.some((r) => Math.abs(r - radius) > radius * 0.2)
    )
      continue;
    const sectors = new Set(
      pts.map((p) =>
        Math.floor(
          ((Math.atan2(p.y - cy, p.x - cx) + Math.PI) / (2 * Math.PI)) * 12,
        ),
      ),
    );
    if (sectors.size < 10) continue;
    result.push({ x: cx, y: cy / aspect, rx: radius, ry: radius / aspect });
  }
  return result;
}

/** Join collinear dash fragments, without bridging missing drawing regions. */
function joinGridDashes(lines: SnapSegment[], aspect: number): SnapSegment[] {
  const groups = new Map<
    string,
    { axis: "x" | "y"; position: number; spans: [number, number][] }
  >();
  for (const l of lines) {
    const dx = Math.abs(l.x2 - l.x1),
      dy = Math.abs(l.y2 - l.y1) * aspect;
    const axis =
      dx < 0.00001 && dy > 0.0001
        ? "x"
        : dy < 0.00001 && dx > 0.0001
          ? "y"
          : null;
    if (!axis) continue;
    const position =
      axis === "x" ? (l.x1 + l.x2) / 2 : ((l.y1 + l.y2) * aspect) / 2;
    const key = axis + Math.round(position * 100000);
    const g = groups.get(key) ?? { axis, position, spans: [] };
    const a = axis === "x" ? l.y1 * aspect : l.x1,
      b = axis === "x" ? l.y2 * aspect : l.x2;
    g.spans.push([Math.min(a, b), Math.max(a, b)]);
    groups.set(key, g);
  }
  const result: SnapSegment[] = [];
  for (const g of groups.values()) {
    g.spans.sort((a, b) => a[0] - b[0]);
    let start = g.spans[0]![0],
      end = g.spans[0]![1];
    const push = () =>
      result.push(
        g.axis === "x"
          ? {
              x1: g.position,
              x2: g.position,
              y1: start / aspect,
              y2: end / aspect,
            }
          : {
              y1: g.position / aspect,
              y2: g.position / aspect,
              x1: start,
              x2: end,
            },
      );
    for (const [a, b] of g.spans.slice(1)) {
      if (a - end <= 0.006) end = Math.max(end, b);
      else {
        push();
        start = a;
        end = b;
      }
    }
    push();
  }
  return result;
}
