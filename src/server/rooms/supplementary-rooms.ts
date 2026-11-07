import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory.js";
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import OverlayOp from "jsts/org/locationtech/jts/operation/overlay/OverlayOp.js";
import { type RoomPoint, type RoomPolygonShape } from "~/lib/room-shape";
import type { PdfLabel, WallSegment } from "./pdf-walls";

export type SupplementalSeed = PdfLabel & {
  tag: PdfLabel;
  anchors: RoomPoint[];
};
export type SupplementalRoom = { name: string; shape: RoomPolygonShape };
// Whole architectural names only: neither bare ROOM nor bare numbers are seeds.
const NAME =
  /^(?:(?:UNIVERSAL\s+)?W\/C|GET READY|SERVICE|(?:GROUP\s+)?(?:MEETING|FOCUS|BRAINSTORMING)(?:\s+ROOM)?|(?:LEASING\s+)?OFFICE)$/i;
const NUMBER = /^\d{2,4}[A-Z]?$/i;

/** Assemble adjacent source runs and an unambiguous tag in the text's own frame. */
export function supplementaryRoomSeeds(labels: PdfLabel[]): SupplementalSeed[] {
  const result: SupplementalSeed[] = [];
  for (const label of labels) {
    if (
      !NAME.test(label.name) ||
      label.x < 0.025 ||
      label.x > 0.92 ||
      label.y < 0.025 ||
      label.y > 0.96
    )
      continue;
    const [textStart, textEnd] = label.anchors ?? [];
    const angle =
      textStart && textEnd
        ? Math.atan2(textEnd.y - textStart.y, textEnd.x - textStart.x)
        : -(label.angle ?? 0);
    const relative = (other: PdfLabel) => {
      const x = other.x - label.x,
        y = other.y - label.y;
      return {
        along: x * Math.cos(angle) + y * Math.sin(angle),
        below: -x * Math.sin(angle) + y * Math.cos(angle),
      };
    };
    const aligned = labels.filter(
      (other) =>
        other !== label &&
        Math.abs((other.angle ?? 0) - (label.angle ?? 0)) < 0.04 &&
        Math.abs(relative(other).along) < 0.008 &&
        relative(other).below > 0.001 &&
        relative(other).below < 0.018,
    );
    const continuation = !/ROOM$/i.test(label.name)
      ? aligned.find(
          (other) =>
            /^ROOM$/i.test(other.name) && relative(other).below < 0.007,
        )
      : undefined;
    const tags = aligned
      .filter(
        (other) =>
          NUMBER.test(other.name) &&
          (!continuation ||
            relative(other).below > relative(continuation).below),
      )
      .sort((a, b) => relative(a).below - relative(b).below);
    const tag = tags[0];
    if (
      !tag ||
      (tags[1] && relative(tags[1]).below - relative(tag).below < 0.002)
    )
      continue;
    // A tag may not be borrowed by a neighbouring same-name room.
    if (result.some((seed) => seed.tag === tag)) continue;
    result.push({
      ...label,
      name: `${label.name}${continuation ? " ROOM" : ""} ${tag.name}`,
      tag,
      anchors: [
        ...(label.anchors ?? []),
        ...(continuation ? [continuation] : []),
        tag,
      ],
    });
  }
  return result;
}

const reader = new GeoJSONReader(new GeometryFactory());
function geometry(shape: RoomPolygonShape) {
  const points = shape.points.map((p) => [p.x, p.y]);
  return reader.read({
    type: "Polygon",
    coordinates: [
      [...points, points[0]],
      ...(shape.holes ?? []).map((ring) => {
        const p = ring.map((v) => [v.x, v.y]);
        return [...p, p[0]];
      }),
    ],
  });
}
export function roomArea(shape: RoomPolygonShape) {
  try {
    return geometry(shape).getArea() as number;
  } catch {
    return 0;
  }
}

export function roomOverlap(a: RoomPolygonShape, b: RoomPolygonShape) {
  try {
    return OverlayOp.intersection(geometry(a), geometry(b)).getArea() as number;
  } catch {
    return Number.POSITIVE_INFINITY;
  } // Topology uncertainty never licenses a save.
}
function distance(p: RoomPoint, s: WallSegment) {
  const dx = s.x2 - s.x1,
    dy = s.y2 - s.y1;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(p.x - s.x1 - t * dx, p.y - s.y1 - t * dy);
}

/** Reject missing boundary runs; isolated source-backed door gaps are permitted.
 * No hulls, boxes, area estimates or polygon clipping are used for recovery. */
export function supportedRoomBoundary(
  shape: RoomPolygonShape,
  source: WallSegment[],
  arcs: WallSegment[],
) {
  source = source.filter((s) => !s.dashed && !s.curve);
  arcs = arcs.filter((s) => !s.dashed);
  let total = 0,
    unsupported = 0;
  for (let i = 0; i < shape.points.length; i++) {
    const a = shape.points[i]!,
      b = shape.points[(i + 1) % shape.points.length]!;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy);
    const parallel = source.filter(
      (s) =>
        Math.abs(dx * (s.y2 - s.y1) - dy * (s.x2 - s.x1)) <=
        length * Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * 0.04,
    );
    const count = Math.max(2, Math.ceil(length / 0.0004));
    let gap = 0,
      supportedSamples = 0;
    for (let j = 0; j <= count; j++) {
      const p = { x: a.x + (dx * j) / count, y: a.y + (dy * j) / count };
      const support = parallel.some((s) => distance(p, s) < 0.0015);
      // Gaps may continue between drawn collinear runs, not turn at a void.
      if (
        (j === 0 || j === count) &&
        length > 0.0015 &&
        !parallel.some((s) => distance(p, s) < 0.002)
      )
        return false;
      total += length / (count + 1);
      if (support) {
        gap = 0;
        supportedSamples++;
        continue;
      }
      const step = length / count;
      gap += step;
      unsupported += length / (count + 1);
      // A doorway requires nearby source swing evidence, not merely a short gap.
      if (
        gap > 0.0015 &&
        (gap > 0.012 || !arcs.some((s) => distance(p, s) < 0.009))
      )
        return false;
    }
    // Door thresholds continue a drawn wall; never accept an invented return
    // made entirely of unsupported segments beside a curved corner.
    if (length > 0.0015 && supportedSamples / (count + 1) < 0.3) return false;
  }
  return total > 0 && unsupported / total < 0.16;
}
