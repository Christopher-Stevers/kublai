import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory.js";
import OverlayOp from "jsts/org/locationtech/jts/operation/overlay/OverlayOp.js";
import {
  pointInPolygon,
  type RoomPoint,
  type RoomPolygonShape,
} from "~/lib/room-shape";
import {
  buildFloorGraph,
  facesAtPoint,
  type FloorGraph,
  type Logger,
} from "./floor-graph";
import type { FloorLinework, PdfLabel, WallSegment } from "./pdf-walls";
import { polygonizeLines, unionRoomFaces } from "./polygonize-walls";
import { buildWallLinework } from "./wall-lines";
import { sourceRoomInterior } from "./source-room-interior";

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
    coordinates: [[...points, points[0]]],
  });
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

/** Append-only detection. Baseline objects and ownership are never modified. */
export async function detectSupplementaryRooms(
  linework: FloorLinework,
  labels: PdfLabel[],
  baseline: SupplementalRoom[],
  graph: FloorGraph,
  log: Logger = () => undefined,
) {
  const seeds = supplementaryRoomSeeds(labels);
  const rooms: SupplementalRoom[] = [];
  const unresolved: Array<{ name: string; reason: string }> = [];
  const pool = (linework.supplementarySegments ?? linework.segments).filter(
    (s) => !s.dashed && !s.curve,
  );
  let localPasses = 0;
  if (seeds.length) {
    await log(`Checking ${seeds.length} extra named rooms…`);
  }
  for (const [index, seed] of seeds.entries()) {
    if (baseline.some((r) => pointInPolygon(seed, r.shape))) continue;
    await log(
      `Supplement ${index + 1}/${seeds.length}: trying ${seed.name}…`,
    );
    const nearby = (s: WallSegment) =>
      Math.min(s.x1, s.x2) < seed.x + 0.065 &&
      Math.max(s.x1, s.x2) > seed.x - 0.065 &&
      Math.min(s.y1, s.y2) < seed.y + 0.085 &&
      Math.max(s.y1, s.y2) > seed.y - 0.085;
    const source = pool.filter(nearby),
      arcs = linework.arcs.filter((s) => !s.dashed && nearby(s));
    const candidates: RoomPolygonShape[] = [];
    // Direct spaces only: no global reassignment and no orphan absorption.
    for (const face of facesAtPoint(graph, seed)) {
      const space = graph.spaces[face.space];
      if (!space || space.blocked || face.outside) continue;
      const shape = unionRoomFaces(
        space.faceIds.map((id) => graph.faces[id]!.shape),
        seed,
        0,
      );
      if (shape) candidates.push(sourceRoomInterior(shape, source, seed, arcs));
    }
    const validate = (shape: RoomPolygonShape) => {
      if (![seed, ...seed.anchors].every((p) => pointInPolygon(p, shape)))
        return "incomplete name/tag enclosure";
      if (seeds.some((other) => other !== seed && pointInPolygon(other, shape)))
        return "contains another room label";
      if (
        [...baseline, ...rooms].some((r) => roomOverlap(shape, r.shape) > 1e-10)
      )
        return "overlaps frozen room";
      if (!supportedRoomBoundary(shape, source, arcs))
        return "unsupported perimeter or circulation leak";
      return null;
    };
    let accepted = candidates.find((shape) => !validate(shape));
    // Retain thin and short source strokes locally, never change the global budget.
    // Oversized neighbourhoods fail closed rather than dropping glazing again.
    if (!accepted && source.length <= 3000 && localPasses < 32) {
      localPasses++;
      const yScale =
        (linework.pageHeight ?? 1) / Math.max(linework.pageWidth ?? 1, 1);
      const [start, end] = seed.anchors;
      const angle =
        start && end
          ? Math.atan2((end.y - start.y) * yScale, end.x - start.x)
          : 0;
      const cos = Math.cos(angle),
        sin = Math.sin(angle);
      const forward = (p: RoomPoint) => {
        const x = p.x - seed.x,
          y = (p.y - seed.y) * yScale;
        return { x: x * cos + y * sin, y: -x * sin + y * cos };
      };
      const inverse = (p: RoomPoint) => ({
        x: p.x * cos - p.y * sin + seed.x,
        y: (p.x * sin + p.y * cos) / yScale + seed.y,
      });
      const transform = (s: WallSegment) => {
        const a = forward({ x: s.x1, y: s.y1 }),
          b = forward({ x: s.x2, y: s.y2 });
        return { ...s, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      };
      const walls = buildWallLinework(source.map(transform), {
        arcs: arcs.map(transform),
      });
      const detailedGraph = buildFloorGraph({
        ...linework,
        segments: source.map(transform),
        arcs: arcs.map(transform),
      });
      const detailedShapes = facesAtPoint(detailedGraph, {
        x: 0,
        y: 0,
      }).flatMap((face) => {
        const space = detailedGraph.spaces[face.space];
        if (!space || space.blocked || face.outside) return [];
        const shape = unionRoomFaces(
          space.faceIds.map((id) => detailedGraph.faces[id]!.shape),
          { x: 0, y: 0 },
          0,
        );
        return shape
          ? [{ type: "polygon" as const, points: shape.points.map(inverse) }]
          : [];
      });
      const faces = polygonizeLines([
        ...walls.strong,
        ...walls.bridges.filter((b) => b.strong).map((b) => b.segment),
      ]);
      for (const face of faces) {
        if (face.holes.length || !pointInPolygon({ x: 0, y: 0 }, face))
          continue;
        const shape: RoomPolygonShape = {
          type: "polygon",
          points: face.points.map(inverse),
        };
        // Never accept an enclosure whose boundary is the neighbourhood cutoff.
        if (
          shape.points.some(
            (p) =>
              Math.abs(p.x - seed.x) > 0.06 || Math.abs(p.y - seed.y) > 0.08,
          )
        )
          continue;
        // Restoring thin/detail topology must not change the enclosure.
        // Disagreement is ambiguity, not permission to absorb missing faces.
        const topologyAgrees = detailedShapes.some((detail) => {
          const intersection = roomOverlap(shape, detail);
          return (
            Number.isFinite(intersection) &&
            intersection / geometry(shape).getArea() >= 0.98 &&
            intersection / geometry(detail).getArea() >= 0.98
          );
        });
        if (!topologyAgrees) continue;
        candidates.push(shape);
        if (!validate(shape)) {
          accepted = shape;
          break;
        }
      }
    }
    if (accepted) {
      rooms.push({ name: seed.name, shape: accepted });
      await log(`Supplement: accepted ${seed.name}`);
    } else {
      const reason =
        source.length > 3000
          ? "local segment safety budget exceeded"
          : candidates.length
            ? (validate(candidates[0]!) ?? "ambiguous boundary")
            : "no complete supported enclosure";
      unresolved.push({ name: seed.name, reason });
      await log(`Supplement: omitted ${seed.name}: ${reason}`);
    }
  }
  return { rooms, unresolved };
}
