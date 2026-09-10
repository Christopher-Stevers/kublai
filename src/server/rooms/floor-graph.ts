import type { RoomPoint, RoomPolygonShape } from "~/lib/room-shape";
import { pointInPolygon } from "~/lib/room-shape";

import type { FloorLinework, PdfRoomSeed, WallSegment } from "./pdf-walls";
import {
  MIN_FACE_WIDTH,
  type PolygonFace,
  polygonizeLines,
  subtractRoomShapes,
  unionRoomFaces,
} from "./polygonize-walls";
import {
  GRID,
  buildWallLinework,
  type LineSegment,
  type WallLinework,
} from "./wall-lines";

/**
 * The floor graph is the deterministic core of room detection.
 *
 * - faces: every region bounded by drawn lines
 * - edges: for touching faces, how much of the shared boundary is wall, door
 *   (a door-sized gap in a strong wall) or open (fixture line, tile edge)
 * - spaces: faces glued together across open boundaries — what a person
 *   would call one room
 *
 * Room assignment, click-to-grow and diagnostics all read the same graph.
 */

export type FaceNeighbor = {
  face: number;
  /** Shared boundary length in page units. */
  length: number;
  /** Portion that is a strong wall or wide opening. */
  wallLength: number;
  /** Portion that is a door-sized gap in a strong wall. */
  doorLength: number;
  /** Portion with only weak lines (fixtures, counters, tile). */
  openLength: number;
};

export type FloorFace = {
  id: number;
  shape: PolygonFace;
  area: number;
  centroid: RoomPoint;
  bbox: { x: number; y: number; w: number; h: number };
  perimeter: number;
  /** Long thin faces are corridors/hallways; rooms never grow into them. */
  corridorLike: boolean;
  /** Reachable from an oversized region without crossing a wall: outdoors. */
  outside: boolean;
  /**
   * Longest boundary stretch that borders no face at all and is not a wall:
   * the face opens straight onto the void around the drawing.
   */
  voidLength: number;
  /** The boundary stretches counted in `voidLength`. */
  voidSpans: Array<[RoomPoint, RoomPoint]>;
  neighbors: FaceNeighbor[];
  space: number;
};

export type FloorSpace = {
  id: number;
  faceIds: number[];
  area: number;
  /** Corridor-like or oversized: never claimed by growth. */
  blocked: boolean;
  /** Door-connected spaces and the total door length between them. */
  doors: Map<number, number>;
};

export type FloorGraph = {
  faces: FloorFace[];
  spaces: FloorSpace[];
  wallThickness: number;
  mode: WallLinework["mode"];
  stats: WallLinework["stats"] & {
    faces: number;
    spaces: number;
    outside: number;
    doorEdges: number;
    openEdges: number;
  };
};

export type AssignedRoom = {
  name: string;
  kind: PdfRoomSeed["kind"];
  seed: RoomPoint;
  faceIds: number[];
  shape: RoomPolygonShape;
  basis?: "global-graph" | "local-raster" | "local-wall-cell";
};

export type DetectedFloorRooms = {
  graph: FloorGraph;
  rooms: AssignedRoom[];
};

export type Logger = (message: string) => void;

/** A boundary counts as door/open when at least this much of it is. */
const MIN_PASS_LENGTH = GRID * 4;
/**
 * A weak stretch that runs wall-to-wall is a doorway drawn with thin lines
 * (door leaf, threshold, sidelight), not a fixture — as long as it is no
 * wider than a generous double door, measured in wall thicknesses.
 */
const OPENING_THICKNESS_MULTIPLE = 16;
const MIN_OPENING_SPAN = 0.016;
const MAX_OPENING_SPAN = 0.08;
/** Below this share of strong linework the grading is meaningless. */
const MIN_STRONG_SHARE = 0.2;
/** Aspect ratio + length that marks a hallway rather than a room. */
const CORRIDOR_ASPECT = 5;
const CORRIDOR_MIN_LENGTH = 0.06;
/** Faces bigger than this (~ a whole wing) are never claimed by growth. */
const MAX_GROWTH_FACE_AREA = 0.02;
/**
 * A sizeable face with this much of its outline touching no other face sits
 * on the edge of the drawing: outdoors, or the sheet margin.
 */
/**
 * A face with one boundary stretch this long along nothing (no neighbouring
 * face, no wall) is open to the void around the drawing: it is outdoors.
 * Shorter stubs are corner artefacts of the polygonizer.
 */
const MIN_VOID_LENGTH = 0.006;
/** A space with doors to this many labelled spaces is circulation. */
const CIRCULATION_DOOR_COUNT = 3;
/** Orphan absorption: unowned fixture-sized faces mostly surrounded by one room. */
const ABSORB_MAX_AREA_RATIO = 0.25;
/** More than two long sides: a sliver inside a wall shares only one. */
const ABSORB_MIN_SHARED_RATIO = 0.6;
const MAX_GROWTH_ROUNDS = 12;
const GLOBAL_FACE_CLOSE_DISTANCE = 0.0025;
const MAX_INFERRED_PARTITION_ROUNDS = 3;
const MAX_INFERRED_PARTITION_LENGTH = 0.045;
const CELL = 0.02;

function polygonArea(points: RoomPoint[]) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area / 2);
}

function ringLength(points: RoomPoint[]) {
  let length = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

/** Rotation-invariant dimensions in the polygon's principal-axis frame. */
function orientedDimensions(points: RoomPoint[]) {
  const center = points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  center.x /= points.length;
  center.y /= points.length;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const point of points) {
    const x = point.x - center.x;
    const y = point.y - center.y;
    xx += x * x;
    xy += x * y;
    yy += y * y;
  }
  const angle = Math.atan2(2 * xy, xx - yy) / 2;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  let minAlong = Number.POSITIVE_INFINITY;
  let maxAlong = Number.NEGATIVE_INFINITY;
  let minAcross = Number.POSITIVE_INFINITY;
  let maxAcross = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const along = point.x * ux + point.y * uy;
    const across = -point.x * uy + point.y * ux;
    minAlong = Math.min(minAlong, along);
    maxAlong = Math.max(maxAlong, along);
    minAcross = Math.min(minAcross, across);
    maxAcross = Math.max(maxAcross, across);
  }
  return { w: maxAlong - minAlong, h: maxAcross - minAcross };
}

/** Point test that respects holes (the building inside the site region). */
function faceContains(face: Pick<FloorFace, "shape">, point: RoomPoint) {
  return (
    pointInPolygon(point, face.shape) &&
    !face.shape.holes.some((hole) =>
      pointInPolygon(point, { type: "polygon", points: hole }),
    )
  );
}

function describeFace(id: number, shape: PolygonFace): FloorFace {
  const xs = shape.points.map((point) => point.x);
  const ys = shape.points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(...xs) - x;
  const h = Math.max(...ys) - y;
  const perimeter = [shape.points, ...shape.holes].reduce(
    (sum, ring) => sum + ringLength(ring),
    0,
  );
  const area = shape.holes.reduce(
    (sum, hole) => sum - polygonArea(hole),
    polygonArea(shape.points),
  );
  const sum = shape.points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 },
  );
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  return {
    id,
    shape,
    area,
    centroid: {
      x: sum.x / shape.points.length,
      y: sum.y / shape.points.length,
    },
    bbox: { x, y, w, h },
    perimeter,
    corridorLike:
      short > 0 &&
      long / short >= CORRIDOR_ASPECT &&
      long >= CORRIDOR_MIN_LENGTH,
    outside: false,
    voidLength: 0,
    voidSpans: [],
    neighbors: [],
    space: -1,
  };
}

type Edge = { a: RoomPoint; b: RoomPoint; ux: number; uy: number; len: number };

function faceEdges(face: FloorFace): Edge[] {
  const edges: Edge[] = [];
  for (const points of [face.shape.points, ...face.shape.holes]) {
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < GRID) continue;
      edges.push({ a, b, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len, len });
    }
  }
  return edges;
}

function toEdge(segment: LineSegment): Edge {
  const [[x1, y1], [x2, y2]] = segment;
  const len = Math.hypot(x2 - x1, y2 - y1);
  return {
    a: { x: x1, y: y1 },
    b: { x: x2, y: y2 },
    ux: len ? (x2 - x1) / len : 1,
    uy: len ? (y2 - y1) / len : 0,
    len,
  };
}

function distanceToLine(edge: Edge, point: RoomPoint) {
  return Math.abs(
    (point.x - edge.a.x) * edge.uy - (point.y - edge.a.y) * edge.ux,
  );
}

/**
 * Faces separated by a wall band that left no face of its own (slivers below
 * MIN_FACE_WIDTH, or an unclosed band) still neighbour each other across it,
 * as long as no third face sits in between.
 */
const MAX_LINK_GAP = 0.006;

/**
 * Length of the collinear overlap of two edges, sampled along the midline
 * between them; `gap` is how far apart the two edges run.
 */
function sharedSpan(left: Edge, right: Edge) {
  const cross = Math.abs(left.ux * right.uy - left.uy * right.ux);
  if (cross > 0.02) return null;
  const gap = Math.max(
    distanceToLine(left, right.a),
    distanceToLine(left, right.b),
  );
  if (gap > MAX_LINK_GAP) return null;
  const project = (point: RoomPoint) =>
    (point.x - left.a.x) * left.ux + (point.y - left.a.y) * left.uy;
  const start = Math.max(0, Math.min(project(right.a), project(right.b)));
  const end = Math.min(left.len, Math.max(project(right.a), project(right.b)));
  if (end - start < GRID * 2) return null;
  const midX =
    (right.a.x - left.a.x) * left.uy - (right.a.y - left.a.y) * left.ux;
  const shift = gap > GRID * 1.2 ? Math.sign(midX) * (gap / 2) : 0;
  return {
    start,
    end,
    length: end - start,
    gap,
    toPoint: (t: number): RoomPoint => ({
      x: left.a.x + left.ux * t + left.uy * shift,
      y: left.a.y + left.uy * t - left.ux * shift,
    }),
  };
}

type Span = NonNullable<ReturnType<typeof sharedSpan>>;

function onEdge(
  edges: Edge[],
  point: RoomPoint,
  direction: Edge,
  tolerance: number,
) {
  return edges.some((edge) => {
    if (Math.abs(edge.ux * direction.uy - edge.uy * direction.ux) > 0.05) {
      return false;
    }
    if (distanceToLine(edge, point) > tolerance) return false;
    const t = (point.x - edge.a.x) * edge.ux + (point.y - edge.a.y) * edge.uy;
    return t >= -GRID && t <= edge.len + GRID;
  });
}

function distanceToSegment(edge: Edge, point: RoomPoint) {
  const t = Math.max(
    0,
    Math.min(
      edge.len,
      (point.x - edge.a.x) * edge.ux + (point.y - edge.a.y) * edge.uy,
    ),
  );
  return Math.hypot(
    edge.a.x + edge.ux * t - point.x,
    edge.a.y + edge.uy * t - point.y,
  );
}

/**
 * A jamb: a strong wall running along `direction` that reaches `point`. A
 * thin line between two jambs is a threshold; one whose ends merely touch
 * the sides of crossing walls (a room tag box, a counter edge) is not.
 */
function jambAt(
  walls: Edge[],
  point: RoomPoint,
  direction: Edge,
  tolerance: number,
) {
  return walls.some(
    (wall) =>
      Math.abs(wall.ux * direction.uy - wall.uy * direction.ux) <= 0.05 &&
      distanceToSegment(wall, point) <= tolerance,
  );
}

type SpanClass = { wall: number; door: number };

/** Sample the shared span and split its length into wall / door / open. */
function classifySpan(
  walls: Edge[],
  doors: Edge[],
  span: Span,
  edge: Edge,
  tolerance: number,
  maxOpening: number,
): SpanClass {
  const samples = Math.max(2, Math.ceil(span.length / GRID));
  let wall = 0;
  let door = 0;
  for (let i = 0; i <= samples; i += 1) {
    const point = span.toPoint(span.start + (span.length * i) / samples);
    if (onEdge(walls, point, edge, tolerance)) wall += 1;
    else if (onEdge(doors, point, edge, tolerance)) door += 1;
  }
  const unit = span.length / (samples + 1);
  const result = { wall: wall * unit, door: door * unit };
  const open = span.length - result.wall - result.door;
  if (
    open >= MIN_PASS_LENGTH &&
    span.length <= maxOpening &&
    jambAt(walls, span.toPoint(span.start), edge, tolerance * 2) &&
    jambAt(walls, span.toPoint(span.end), edge, tolerance * 2)
  ) {
    // Thin-line stretch running wall to wall: a doorway, not a fixture.
    return { wall: result.wall, door: result.door + open };
  }
  return result;
}

class CellIndex<T> {
  private cells = new Map<string, T[]>();

  add(item: T, x0: number, y0: number, x1: number, y1: number) {
    for (const key of this.keys(x0, y0, x1, y1)) {
      const list = this.cells.get(key) ?? [];
      list.push(item);
      this.cells.set(key, list);
    }
  }

  query(x0: number, y0: number, x1: number, y1: number) {
    return [
      ...new Set(
        this.keys(x0, y0, x1, y1).flatMap((key) => this.cells.get(key) ?? []),
      ),
    ];
  }

  private keys(x0: number, y0: number, x1: number, y1: number) {
    const keys: string[] = [];
    for (let x = Math.floor(x0 / CELL); x <= Math.floor(x1 / CELL); x += 1) {
      for (let y = Math.floor(y0 / CELL); y <= Math.floor(y1 / CELL); y += 1) {
        keys.push(`${x}:${y}`);
      }
    }
    return keys;
  }
}

function indexEdges(segments: LineSegment[]) {
  const index = new CellIndex<Edge>();
  for (const edge of segments.map(toEdge)) {
    index.add(
      edge,
      Math.min(edge.a.x, edge.b.x) - GRID,
      Math.min(edge.a.y, edge.b.y) - GRID,
      Math.max(edge.a.x, edge.b.x) + GRID,
      Math.max(edge.a.y, edge.b.y) + GRID,
    );
  }
  return index;
}

function linkNeighbors(
  faces: FloorFace[],
  strong: LineSegment[],
  doors: LineSegment[],
  wallThickness: number,
) {
  const tolerance = Math.max(GRID * 1.5, wallThickness);
  const maxOpening = Math.min(
    MAX_OPENING_SPAN,
    Math.max(MIN_OPENING_SPAN, wallThickness * OPENING_THICKNESS_MULTIPLE),
  );
  const faceIndex = new CellIndex<number>();
  const box = (face: FloorFace) =>
    [
      face.bbox.x - MAX_LINK_GAP,
      face.bbox.y - MAX_LINK_GAP,
      face.bbox.x + face.bbox.w + MAX_LINK_GAP,
      face.bbox.y + face.bbox.h + MAX_LINK_GAP,
    ] as const;
  for (const face of faces) faceIndex.add(face.id, ...box(face));
  const wallIndex = indexEdges(strong);
  const doorIndex = indexEdges(doors);

  // A gap wide enough to hold a face may hold one: sample the midline.
  const faceBetween = (span: Span, a: number, b: number) =>
    [0.25, 0.5, 0.75].some((share) => {
      const point = span.toPoint(span.start + span.length * share);
      return faceIndex
        .query(point.x, point.y, point.x, point.y)
        .some((id) => id !== a && id !== b && faceContains(faces[id]!, point));
    });

  const edgesByFace = faces.map(faceEdges);
  const coverage = edgesByFace.map((edges) =>
    edges.map(() => [] as Array<[number, number]>),
  );
  const cover = (
    faceId: number,
    edgeIndex: number,
    edge: Edge,
    from: RoomPoint,
    to: RoomPoint,
  ) => {
    const project = (point: RoomPoint) =>
      (point.x - edge.a.x) * edge.ux + (point.y - edge.a.y) * edge.uy;
    const s = project(from);
    const e = project(to);
    coverage[faceId]![edgeIndex]!.push([Math.min(s, e), Math.max(s, e)]);
  };
  let doorEdges = 0;
  let openEdges = 0;
  for (const face of faces) {
    const bounds = box(face);
    const walls = wallIndex.query(...bounds);
    const doorEdgesNearby = doorIndex.query(...bounds);
    for (const otherId of faceIndex.query(...bounds)) {
      if (otherId <= face.id) continue;
      const other = faces[otherId]!;
      if (
        other.bbox.x > face.bbox.x + face.bbox.w + MAX_LINK_GAP ||
        face.bbox.x > other.bbox.x + other.bbox.w + MAX_LINK_GAP ||
        other.bbox.y > face.bbox.y + face.bbox.h + MAX_LINK_GAP ||
        face.bbox.y > other.bbox.y + other.bbox.h + MAX_LINK_GAP
      ) {
        continue;
      }
      let length = 0;
      let wallLength = 0;
      let doorLength = 0;
      edgesByFace[face.id]!.forEach((edge, edgeIndex) => {
        edgesByFace[otherId]!.forEach((otherEdge, otherIndex) => {
          const span = sharedSpan(edge, otherEdge);
          if (!span) return;
          if (
            span.gap >= MIN_FACE_WIDTH &&
            faceBetween(span, face.id, otherId)
          ) {
            return;
          }
          const from = span.toPoint(span.start);
          const to = span.toPoint(span.end);
          cover(face.id, edgeIndex, edge, from, to);
          cover(otherId, otherIndex, otherEdge, from, to);
          length += span.length;
          const split = classifySpan(
            walls,
            doorEdgesNearby,
            span,
            edge,
            tolerance + span.gap / 2,
            maxOpening,
          );
          wallLength += split.wall;
          doorLength += split.door;
        });
      });
      if (length < GRID * 2) continue;
      const openLength = Math.max(0, length - wallLength - doorLength);
      const neighbor = { length, wallLength, doorLength, openLength };
      face.neighbors.push({ face: otherId, ...neighbor });
      other.neighbors.push({ face: face.id, ...neighbor });
      if (openLength >= MIN_PASS_LENGTH) openEdges += 1;
      else if (doorLength >= MIN_PASS_LENGTH) doorEdges += 1;
    }
  }
  for (const face of faces) {
    const walls = wallIndex.query(...box(face));
    edgesByFace[face.id]!.forEach((edge, edgeIndex) => {
      // Outward is whichever side of the edge the face itself is not on.
      const mid = {
        x: edge.a.x + (edge.ux * edge.len) / 2,
        y: edge.a.y + (edge.uy * edge.len) / 2,
      };
      const side = faceContains(face, {
        x: mid.x - edge.uy * GRID,
        y: mid.y + edge.ux * GRID,
      })
        ? 1
        : -1;
      const isVoid = (point: RoomPoint) =>
        VOID_PROBE_DEPTHS.every((depth) => {
          const probe = {
            x: point.x + edge.uy * depth * side,
            y: point.y - edge.ux * depth * side,
          };
          return !faceIndex
            .query(probe.x, probe.y, probe.x, probe.y)
            .some((id) => id !== face.id && faceContains(faces[id]!, probe));
        });
      for (const span of voidSpans(
        edge,
        coverage[face.id]![edgeIndex]!,
        walls,
        tolerance,
        isVoid,
      )) {
        face.voidLength = Math.max(face.voidLength, span.length);
        face.voidSpans.push([span.from, span.to]);
      }
    });
  }
  return { doorEdges, openEdges };
}

/**
 * Stretches of `edge` that no other face covers, no strong wall runs along,
 * and that have nothing at all a little further out. A dropped sliver (wall
 * band below MIN_FACE_WIDTH) has a face right behind it; the void does not.
 */
const VOID_PROBE_DEPTHS = [
  MIN_FACE_WIDTH,
  MIN_FACE_WIDTH * 2,
  MIN_FACE_WIDTH * 3,
];

function voidSpans(
  edge: Edge,
  covered: Array<[number, number]>,
  walls: Edge[],
  tolerance: number,
  isVoid: (point: RoomPoint) => boolean,
) {
  const sorted = [...covered].sort((a, b) => a[0] - b[0]);
  const gaps: Array<[number, number]> = [];
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (start > cursor + GRID) gaps.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (edge.len > cursor + GRID) gaps.push([cursor, edge.len]);
  const at = (t: number) => ({
    x: edge.a.x + edge.ux * t,
    y: edge.a.y + edge.uy * t,
  });
  const spans: Array<{ from: RoomPoint; to: RoomPoint; length: number }> = [];
  for (const [start, end] of gaps) {
    const samples = Math.max(2, Math.ceil((end - start) / GRID));
    let open = 0;
    for (let i = 0; i <= samples; i += 1) {
      const t = start + ((end - start) * i) / samples;
      if (!onEdge(walls, at(t), edge, tolerance) && isVoid(at(t))) open += 1;
    }
    const length = ((end - start) * open) / (samples + 1);
    if (length > 0) spans.push({ from: at(start), to: at(end), length });
  }
  return spans;
}

function growable(face: FloorFace) {
  return (
    !face.corridorLike && !face.outside && face.area <= MAX_GROWTH_FACE_AREA
  );
}

/**
 * Anything you can walk to from an oversized region or a face open to the
 * void around the drawing without passing a wall or a door is outdoors. Roof edges,
 * grid lines and dimension strings chop the outside into room-sized faces
 * that would otherwise read as rooms.
 */
function markOutside(faces: FloorFace[]) {
  const queue = faces.filter(
    (face) =>
      face.area > MAX_GROWTH_FACE_AREA || face.voidLength >= MIN_VOID_LENGTH,
  );
  const seen = new Set(queue.map((face) => face.id));
  let marked = queue.length;
  for (const face of queue) face.outside = true;
  while (queue.length) {
    const face = queue.pop()!;
    for (const neighbor of face.neighbors) {
      if (seen.has(neighbor.face) || neighbor.openLength < MIN_PASS_LENGTH) {
        continue;
      }
      const other = faces[neighbor.face]!;
      seen.add(other.id);
      other.outside = true;
      marked += 1;
      queue.push(other);
    }
  }
  return marked;
}

/** Glue faces across open boundaries; blocked faces stay alone. */
function buildSpaces(faces: FloorFace[]): FloorSpace[] {
  const parent = faces.map((face) => face.id);
  const find = (id: number): number => {
    while (parent[id] !== id) {
      parent[id] = parent[parent[id]!]!;
      id = parent[id]!;
    }
    return id;
  };
  for (const face of faces) {
    if (!growable(face)) continue;
    for (const neighbor of face.neighbors) {
      const other = faces[neighbor.face]!;
      if (!growable(other) || neighbor.openLength < MIN_PASS_LENGTH) continue;
      parent[find(face.id)] = find(other.id);
    }
  }
  const byRoot = new Map<number, number[]>();
  for (const face of faces) {
    const root = find(face.id);
    const list = byRoot.get(root) ?? [];
    list.push(face.id);
    byRoot.set(root, list);
  }
  const spaces: FloorSpace[] = [];
  for (const faceIds of byRoot.values()) {
    const id = spaces.length;
    for (const faceId of faceIds) faces[faceId]!.space = id;
    spaces.push({
      id,
      faceIds,
      area: faceIds.reduce((sum, faceId) => sum + faces[faceId]!.area, 0),
      blocked: faceIds.some((faceId) => !growable(faces[faceId]!)),
      doors: new Map(),
    });
  }
  for (const face of faces) {
    for (const neighbor of face.neighbors) {
      const other = faces[neighbor.face]!;
      if (other.space === face.space || neighbor.doorLength < MIN_PASS_LENGTH) {
        continue;
      }
      const doors = spaces[face.space]!.doors;
      doors.set(
        other.space,
        (doors.get(other.space) ?? 0) + neighbor.doorLength,
      );
    }
  }
  return spaces;
}

function graphFromLinework(linework: WallLinework): FloorGraph {
  const faces = polygonizeLines(linework.lines, { keepLarge: true }).map(
    (shape, id) => describeFace(id, shape),
  );
  const edges = linkNeighbors(
    faces,
    linework.strong,
    linework.doors,
    linework.wallThickness,
  );
  const outside = markOutside(faces);
  const spaces = buildSpaces(faces);
  return {
    faces,
    spaces,
    wallThickness: linework.wallThickness,
    mode: linework.mode,
    stats: {
      ...linework.stats,
      faces: faces.length,
      spaces: spaces.length,
      outside,
      ...edges,
    },
  };
}

export function facesAtPoint(graph: FloorGraph, point: RoomPoint) {
  return graph.faces
    .filter((face) => faceContains(face, point))
    .sort((left, right) => left.area - right.area);
}

function pointToSegmentDistance(
  point: RoomPoint,
  start: RoomPoint,
  end: RoomPoint,
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const along =
    lengthSquared === 0
      ? 0
      : Math.min(
          1,
          Math.max(
            0,
            ((point.x - start.x) * dx + (point.y - start.y) * dy) /
              lengthSquared,
          ),
        );
  return Math.hypot(
    point.x - (start.x + along * dx),
    point.y - (start.y + along * dy),
  );
}

function distanceToFace(point: RoomPoint, face: FloorFace) {
  return Math.min(
    ...face.shape.points.map((start, index) =>
      pointToSegmentDistance(
        point,
        start,
        face.shape.points[(index + 1) % face.shape.points.length]!,
      ),
    ),
  );
}

/**
 * PDF text anchors can land directly on a wall after normalization. Recover
 * only when one interior face is uniquely within roughly one wall thickness;
 * wider or ambiguous misses stay omitted.
 */
function spaceNearPoint(graph: FloorGraph, point: RoomPoint) {
  const direct = spaceAtPoint(graph, point);
  if (direct) return direct;
  const maxDistance = Math.max(GRID * 3, graph.wallThickness * 1.5);
  const nearby = graph.faces
    .filter((face) => !face.outside)
    .map((face) => ({ face, distance: distanceToFace(point, face) }))
    .filter((candidate) => candidate.distance <= maxDistance)
    .sort((left, right) => left.distance - right.distance);
  const [nearest, second] = nearby;
  if (!nearest) return null;
  if (
    second &&
    second.face.space !== nearest.face.space &&
    second.distance - nearest.distance < GRID / 2
  ) {
    return null;
  }
  return graph.spaces[nearest.face.space] ?? null;
}

function segmentLength(segments: LineSegment[]) {
  return segments.reduce(
    (sum, [[x1, y1], [x2, y2]]) => sum + Math.hypot(x2 - x1, y2 - y1),
    0,
  );
}

/**
 * Build the face graph from graded linework. When the drawing gives no usable
 * wall evidence (uniform strokes, no layers, no double lines) every line is
 * treated as a wall so rooms at least stay inside their outlines.
 */
export function buildFloorGraph(
  linework: FloorLinework | WallSegment[],
  options: { log?: Logger; mode?: WallLinework["mode"] } = {},
): FloorGraph {
  const segments = Array.isArray(linework) ? linework : linework.segments;
  const arcs = Array.isArray(linework) ? [] : linework.arcs;
  const log = options.log ?? (() => undefined);

  let walls = buildWallLinework(segments, {
    mode: options.mode ?? "graded",
    arcs,
  });
  if (walls.mode === "graded") {
    const strongShare =
      segmentLength(walls.strong) / Math.max(segmentLength(walls.lines), 1e-9);
    const evidence =
      walls.stats.layerLength > 0
        ? "wall layers"
        : walls.stats.heavyLength > 0
          ? "heavy strokes"
          : "no stroke or layer hints";
    log(
      `Wall grading: ${walls.stats.grouped} lines (${walls.stats.gridLines} grid lines stripped) → ${walls.stats.paired} double-line walls (thickness ≈ ${(walls.wallThickness * 1000).toFixed(1)}‰ of page), ${walls.stats.strong} single-line walls from ${evidence}, ${walls.stats.weak} weak lines; ${(strongShare * 100).toFixed(0)}% of linework is wall`,
    );
    if (strongShare < MIN_STRONG_SHARE) {
      log("Too little wall evidence; treating every line as a wall");
      walls = buildWallLinework(segments, { mode: "all", arcs });
    }
  } else {
    log(`Treating all ${walls.stats.grouped} lines as walls`);
  }
  const graph = graphFromLinework(walls);
  log(
    `Faces: ${graph.stats.faces} bounded regions (${graph.stats.outside} outdoors) → ${graph.stats.spaces} spaces (${graph.stats.openEdges} fixture boundaries merged), ${graph.stats.doorEdges} doorways, ${walls.bridges.length} gaps bridged`,
  );
  return graph;
}

/**
 * Pull in unowned fixture-sized faces (counters, closets without a door
 * swing) that are mostly surrounded by a single room. Only faces the room
 * claimed through its doors count as surroundings: absorbed faces never
 * absorb further, or a sliver inside a wall would walk a room outdoors.
 */
function absorbOrphans(
  graph: FloorGraph,
  owner: Map<number, number>,
  blocked: Set<number>,
  roomAreas: Map<number, number>,
) {
  const claimedOwner = new Map(owner);
  for (const face of graph.faces) {
    if (owner.has(face.id) || blocked.has(face.id) || !growable(face)) {
      continue;
    }
    const shared = new Map<number, number>();
    for (const neighbor of face.neighbors) {
      const room = claimedOwner.get(neighbor.face);
      if (room === undefined) continue;
      shared.set(room, (shared.get(room) ?? 0) + neighbor.length);
    }
    if (shared.size !== 1) continue;
    const [room, length] = [...shared.entries()][0]!;
    const roomArea = roomAreas.get(room) ?? 0;
    if (
      length >= face.perimeter * ABSORB_MIN_SHARED_RATIO &&
      face.area <= roomArea * ABSORB_MAX_AREA_RATIO
    ) {
      owner.set(face.id, room);
      roomAreas.set(room, roomArea + face.area);
    }
  }
}

function spaceAtPoint(graph: FloorGraph, point: RoomPoint) {
  const face = facesAtPoint(graph, point)[0];
  return face ? graph.spaces[face.space]! : null;
}

const MAX_UNIT_LABEL_ENCLOSURE_AREA = 0.0003;
const MAX_UNIT_LABEL_ENCLOSURE_SPAN = 0.04;

function spaceBounds(graph: FloorGraph, space: FloorSpace) {
  const faces = space.faceIds.map((faceId) => graph.faces[faceId]!);
  const x = Math.min(...faces.map((face) => face.bbox.x));
  const y = Math.min(...faces.map((face) => face.bbox.y));
  const right = Math.max(...faces.map((face) => face.bbox.x + face.bbox.w));
  const bottom = Math.max(...faces.map((face) => face.bbox.y + face.bbox.h));
  return {
    x,
    y,
    w: right - x,
    h: bottom - y,
    oriented: orientedDimensions(faces.flatMap((face) => face.shape.points)),
  };
}

/**
 * Flattened/rotated PDF imports often turn the printed unit-tag outline into
 * four heavy vectors. The label then lands in a tiny sealed face instead of
 * the suite around it. Escape only compact, dead-end enclosures and only to a
 * substantially larger, growable space sharing a real boundary with it.
 */
function escapeUnitLabelEnclosure(
  graph: FloorGraph,
  origin: FloorSpace,
  reservedSpaces: Set<number>,
  log: Logger,
) {
  const bounds = spaceBounds(graph, origin);
  const compact =
    origin.area <= MAX_UNIT_LABEL_ENCLOSURE_AREA &&
    Math.max(bounds.oriented.w, bounds.oriented.h) <=
      MAX_UNIT_LABEL_ENCLOSURE_SPAN;
  if (!compact || origin.doors.size > 1) return origin;

  const adjacent = new Map<number, { space: FloorSpace; shared: number }>();
  const perimeter = origin.faceIds.reduce(
    (sum, faceId) => sum + graph.faces[faceId]!.perimeter,
    0,
  );
  for (const faceId of origin.faceIds) {
    for (const neighbor of graph.faces[faceId]!.neighbors) {
      const otherFace = graph.faces[neighbor.face]!;
      if (otherFace.space === origin.id) continue;
      const space = graph.spaces[otherFace.space]!;
      if (space.blocked || reservedSpaces.has(space.id)) continue;
      const current = adjacent.get(space.id) ?? { space, shared: 0 };
      current.shared += neighbor.length;
      adjacent.set(space.id, current);
    }
  }
  const minimumShared = Math.max(
    GRID * 4,
    graph.wallThickness * 2,
    perimeter * 0.2,
  );
  const candidate = [...adjacent.values()]
    .filter(
      ({ space, shared }) =>
        shared >= minimumShared && space.area >= origin.area * 3,
    )
    .sort(
      (left, right) =>
        right.shared - left.shared || right.space.area - left.space.area,
    )[0];
  if (!candidate) return origin;
  log(
    "Unit label escaped a compact dead-end enclosure into adjacent bounded space",
  );
  return candidate.space;
}

function spaceCentroid(graph: FloorGraph, space: FloorSpace): RoomPoint {
  let x = 0;
  let y = 0;
  for (const faceId of space.faceIds) {
    const face = graph.faces[faceId]!;
    x += face.centroid.x * face.area;
    y += face.centroid.y * face.area;
  }
  return { x: x / space.area, y: y / space.area };
}

/**
 * Lock-step growth through doorways from several starting spaces at once.
 * Each round every room claims the unclaimed spaces behind its doors. A space
 * two rooms reach in the same round is shared territory (a corridor, a lobby,
 * a common closet): it is left unclaimed and closed to further growth rather
 * than handed to whichever label happens to be nearer.
 */
function growSpaces(
  graph: FloorGraph,
  origins: Map<number, { space: number; point: RoomPoint }>,
  claimed: Map<number, number>,
  unavailable: Set<number>,
) {
  let frontier = [...origins.entries()].map(([room, origin]) => ({
    room,
    space: origin.space,
  }));
  let contested = 0;
  const rounds = new Map<number, number>();
  for (
    let round = 0;
    round < MAX_GROWTH_ROUNDS && frontier.length;
    round += 1
  ) {
    const claims = new Map<number, Set<number>>();
    for (const item of frontier) {
      for (const next of graph.spaces[item.space]!.doors.keys()) {
        const space = graph.spaces[next]!;
        if (space.blocked || claimed.has(next) || unavailable.has(next)) {
          continue;
        }
        const rooms = claims.get(next) ?? new Set<number>();
        rooms.add(item.room);
        claims.set(next, rooms);
      }
    }
    frontier = [];
    for (const [space, rooms] of claims) {
      if (rooms.size > 1) {
        unavailable.add(space);
        contested += 1;
        continue;
      }
      const room = [...rooms][0]!;
      claimed.set(space, room);
      rounds.set(space, round + 1);
      frontier.push({ room, space });
    }
  }
  return { contested, rounds };
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * Recover unit interiors that a flattened PDF divided with uninterrupted
 * partition strokes. The printed square footage supplies the page scale;
 * ownership expands only over real bounded graph spaces, stays within that
 * area budget, and advances all units in lock-step so traversal order never
 * hands a contested space to one neighbouring suite.
 */
function recoverUnitInteriors(
  graph: FloorGraph,
  seeds: PdfRoomSeed[],
  claimed: Map<number, number>,
  reserved: Set<number>,
  unavailable: Set<number>,
  eligibleRounds: Map<number, number>,
  targetAreas: Map<number, number>,
) {
  const roomAreas = new Map<number, number>();
  for (const [space, room] of claimed) {
    if (seeds[room]?.kind !== "unit") continue;
    roomAreas.set(room, (roomAreas.get(room) ?? 0) + graph.spaces[space]!.area);
  }
  let frontier = [...claimed.entries()]
    .filter(
      ([, room]) =>
        seeds[room]?.kind === "unit" && (eligibleRounds.get(room) ?? 0) > 0,
    )
    .map(([space, room]) => ({ space, room }));
  let recovered = 0;
  let contested = 0;
  for (
    let round = 0;
    round < MAX_INFERRED_PARTITION_ROUNDS && frontier.length;
    round += 1
  ) {
    const proposals = new Map<number, Set<number>>();
    for (const { space: spaceId, room } of frontier) {
      if ((eligibleRounds.get(room) ?? 0) <= round) continue;
      const boundaries = new Map<number, { length: number; wall: number }>();
      for (const faceId of graph.spaces[spaceId]!.faceIds) {
        for (const neighbor of graph.faces[faceId]!.neighbors) {
          const next = graph.faces[neighbor.face]!.space;
          if (next !== spaceId) {
            const boundary = boundaries.get(next) ?? { length: 0, wall: 0 };
            boundary.length += neighbor.length;
            boundary.wall += neighbor.wallLength;
            boundaries.set(next, boundary);
          }
        }
      }
      for (const [next, boundary] of boundaries) {
        const candidate = graph.spaces[next]!;
        const targetArea = targetAreas.get(room) ?? 0;
        const falseOutsideCandidate =
          targetArea > 0 &&
          candidate.area <= targetArea * 0.2 &&
          candidate.faceIds.every((faceId) => {
            const face = graph.faces[faceId]!;
            return (
              face.outside &&
              face.area <= targetArea * 0.2 &&
              face.voidLength < MIN_VOID_LENGTH * 2
            );
          });
        const candidateCenter = spaceCentroid(graph, candidate);
        const roomSeedDistance = Math.hypot(
          candidateCenter.x - seeds[room]!.x,
          candidateCenter.y - seeds[room]!.y,
        );
        const closerForeignSeed = seeds.some(
          (seed, seedIndex) =>
            seedIndex !== room &&
            Math.hypot(candidateCenter.x - seed.x, candidateCenter.y - seed.y) <
              roomSeedDistance,
        );
        const inferredPartitionCandidate =
          targetArea > 0 &&
          candidate.area <= targetArea * 0.25 &&
          boundary.wall >= boundary.length * 0.9;
        if (
          boundary.wall < boundary.length * 0.75 ||
          (falseOutsideCandidate && closerForeignSeed) ||
          (boundary.length > MAX_INFERRED_PARTITION_LENGTH &&
            !falseOutsideCandidate) ||
          (candidate.blocked && !falseOutsideCandidate) ||
          claimed.has(next) ||
          reserved.has(next) ||
          (unavailable.has(next) && !inferredPartitionCandidate)
        ) {
          continue;
        }
        const rooms = proposals.get(next) ?? new Set<number>();
        rooms.add(room);
        proposals.set(next, rooms);
      }
    }
    frontier = [];
    const candidatesByRoom = new Map<number, number[]>();
    for (const [space, rooms] of proposals) {
      let room: number;
      if (rooms.size === 1) {
        room = [...rooms][0]!;
      } else {
        const center = spaceCentroid(graph, graph.spaces[space]!);
        const ranked = [...rooms]
          .map((candidate) => ({
            room: candidate,
            distance: Math.hypot(
              center.x - seeds[candidate]!.x,
              center.y - seeds[candidate]!.y,
            ),
          }))
          .sort(
            (left, right) =>
              left.distance - right.distance || left.room - right.room,
          );
        if (
          !ranked[0] ||
          (ranked[1] && ranked[1].distance - ranked[0].distance < GRID)
        ) {
          unavailable.add(space);
          contested += 1;
          continue;
        }
        room = ranked[0].room;
      }
      const candidates = candidatesByRoom.get(room) ?? [];
      candidates.push(space);
      candidatesByRoom.set(room, candidates);
    }
    for (const [room, spaces] of candidatesByRoom) {
      const seed = seeds[room]!;
      spaces.sort((left, right) => {
        const a = spaceCentroid(graph, graph.spaces[left]!);
        const b = spaceCentroid(graph, graph.spaces[right]!);
        return (
          Math.hypot(a.x - seed.x, a.y - seed.y) -
            Math.hypot(b.x - seed.x, b.y - seed.y) || left - right
        );
      });
      for (const space of spaces) {
        const candidate = graph.spaces[space]!;
        const area = roomAreas.get(room) ?? 0;
        const targetArea = targetAreas.get(room) ?? 0;
        if (targetArea > 0 && area + candidate.area > targetArea * 1.15) {
          continue;
        }
        claimed.set(space, room);
        roomAreas.set(room, area + candidate.area);
        frontier.push({ space, room });
        recovered += 1;
      }
    }
  }
  const claimedBeforeEnclosurePass = new Map(claimed);
  const enclosedByRoom = new Map<
    number,
    Array<{
      candidate: FloorSpace;
      boundary: { length: number; wall: number };
    }>
  >();
  for (const candidate of graph.spaces) {
    if (claimed.has(candidate.id) || reserved.has(candidate.id)) {
      continue;
    }
    const shared = new Map<number, { length: number; wall: number }>();
    for (const faceId of candidate.faceIds) {
      for (const neighbor of graph.faces[faceId]!.neighbors) {
        const room = claimedBeforeEnclosurePass.get(
          graph.faces[neighbor.face]!.space,
        );
        if (room === undefined || seeds[room]?.kind !== "unit") continue;
        const boundary = shared.get(room) ?? { length: 0, wall: 0 };
        boundary.length += neighbor.length;
        boundary.wall += neighbor.wallLength;
        shared.set(room, boundary);
      }
    }
    if (shared.size !== 1) continue;
    const [room, boundary] = [...shared.entries()][0]!;
    const targetArea = targetAreas.get(room) ?? 0;
    const ownedArea = roomAreas.get(room) ?? 0;
    if (
      targetArea <= 0 ||
      candidate.area > Math.max(targetArea * 0.25, ownedArea * 0.1) ||
      boundary.wall < boundary.length * 0.9
    ) {
      continue;
    }
    const candidates = enclosedByRoom.get(room) ?? [];
    candidates.push({ candidate, boundary });
    enclosedByRoom.set(room, candidates);
  }
  for (const [room, candidates] of enclosedByRoom) {
    const targetArea = targetAreas.get(room)!;
    const area = roomAreas.get(room) ?? 0;
    const selected = candidates
      .sort(
        (left, right) =>
          right.candidate.area - left.candidate.area ||
          right.boundary.wall / right.boundary.length -
            left.boundary.wall / left.boundary.length ||
          right.boundary.length - left.boundary.length ||
          left.candidate.id - right.candidate.id,
      )
      .find(
        ({ candidate }) => area + candidate.area <= targetArea * 1.25,
      )?.candidate;
    if (!selected) continue;
    claimed.set(selected.id, room);
    roomAreas.set(room, area + selected.area);
    recovered += 1;
  }
  return { recovered, contested };
}

/** Openings at least this wide between two spaces are corridor continuations, not doors. */
const WIDE_OPENING = 0.012;

/**
 * Hallways rarely end where the contest does: a dead-end stub off a shared
 * corridor is reached by one unit only, so growth walks down it. Peel such
 * claims back: a space that a unit reached indirectly (not through its own
 * label's space) and that opens wide onto circulation is circulation too.
 */
function peelCirculation(
  graph: FloorGraph,
  claimed: Map<number, number>,
  rounds: Map<number, number>,
  circulation: Set<number>,
) {
  let peeled = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [spaceId, round] of rounds) {
      if (round < 2 || !claimed.has(spaceId)) continue;
      const space = graph.spaces[spaceId]!;
      const wideOntoHallway = [...space.doors.entries()].some(
        ([next, length]) => circulation.has(next) && length >= WIDE_OPENING,
      );
      if (!wideOntoHallway) continue;
      claimed.delete(spaceId);
      circulation.add(spaceId);
      peeled += 1;
      changed = true;
    }
  }
  return peeled;
}

function finishRooms(
  graph: FloorGraph,
  seeds: PdfRoomSeed[],
  owner: Map<number, number>,
  log: Logger,
  closeDistance = 0,
) {
  const faceIdsByRoom = new Map<number, number[]>();
  for (const [faceId, room] of owner) {
    const list = faceIdsByRoom.get(room) ?? [];
    list.push(faceId);
    faceIdsByRoom.set(room, list);
  }
  const rooms: AssignedRoom[] = [];
  seeds.forEach((seed, index) => {
    const faceIds = faceIdsByRoom.get(index);
    if (!faceIds?.length) return;
    const shape = unionRoomFaces(
      faceIds.map((id) => graph.faces[id]!.shape),
      seed,
      closeDistance,
    );
    if (!shape) {
      log(`${seed.name}: could not merge ${faceIds.length} regions`);
      return;
    }
    rooms.push({
      name: seed.name,
      kind: seed.kind,
      seed: { x: seed.x, y: seed.y },
      faceIds,
      shape,
      basis: "global-graph",
    });
  });
  return rooms;
}

/**
 * Deterministic ownership. Every label claims the space it sits in. Spaces
 * with doors onto several labelled spaces are circulation and stay unclaimed.
 * Unit labels then grow through their doors until they meet a wall, a
 * hallway, or territory another label reached first.
 */
export function assignRooms(
  graph: FloorGraph,
  seeds: PdfRoomSeed[],
  log: Logger = () => undefined,
  options: { closeDistance?: number } = {},
): AssignedRoom[] {
  const claimed = new Map<number, number>();
  const origins = new Map<number, { space: number; point: RoomPoint }>();
  const interiorRecoveryRounds = new Map<number, number>();
  const seedSpaces = new Set<number>();
  const initialSpaces = seeds.map(
    (seed) =>
      spaceNearPoint(graph, seed) ??
      (seed.anchors ?? [])
        .map((point) => spaceNearPoint(graph, point))
        .find(Boolean) ??
      null,
  );
  const reservedSpaces = new Set(
    initialSpaces.flatMap((space) => (space ? [space.id] : [])),
  );
  seeds.forEach((seed, index) => {
    let space = initialSpaces[index];
    if (!space) {
      log(`${seed.name}: label is not inside any bounded region`);
      return;
    }
    if (seed.kind === "unit") {
      const initial = space;
      space = escapeUnitLabelEnclosure(graph, space, reservedSpaces, log);
      if (space.id !== initial.id) {
        interiorRecoveryRounds.set(index, MAX_INFERRED_PARTITION_ROUNDS);
      }
    }
    const holder = claimed.get(space.id);
    if (holder !== undefined) {
      log(
        `${seed.name}: shares a space with ${seeds[holder]!.name} (no wall between them)`,
      );
      return;
    }
    claimed.set(space.id, index);
    seedSpaces.add(space.id);
    if (seed.kind === "unit") {
      origins.set(index, { space: space.id, point: { x: seed.x, y: seed.y } });
    }
  });

  const circulation = new Set<number>();
  for (const space of graph.spaces) {
    if (claimed.has(space.id)) continue;
    let labelled = 0;
    for (const next of space.doors.keys()) {
      if (seedSpaces.has(next)) labelled += 1;
    }
    if (labelled >= CIRCULATION_DOOR_COUNT) circulation.add(space.id);
  }
  if (circulation.size) {
    log(
      `${circulation.size} unlabelled space${circulation.size === 1 ? "" : "s"} with doors to ${CIRCULATION_DOOR_COUNT}+ rooms treated as hallways`,
    );
  }

  const { contested, rounds } = growSpaces(
    graph,
    origins,
    claimed,
    circulation,
  );
  if (contested) {
    log(
      `${contested} space${contested === 1 ? "" : "s"} reached by several units at once left as shared/circulation`,
    );
  }
  const unitAreas = new Map<number, number>();
  for (const [spaceId, room] of claimed) {
    if (seeds[room]?.kind !== "unit") continue;
    unitAreas.set(
      room,
      (unitAreas.get(room) ?? 0) + graph.spaces[spaceId]!.area,
    );
  }
  const areaScale = median(
    [...unitAreas.entries()].flatMap(([room, area]) => {
      const squareFeet = seeds[room]?.areaSqFt;
      return squareFeet ? [area / squareFeet] : [];
    }),
  );
  const targetAreas = new Map<number, number>();
  if (areaScale > 0) {
    for (const [room, area] of unitAreas) {
      const squareFeet = seeds[room]?.areaSqFt;
      if (!squareFeet) continue;
      const targetArea = squareFeet * areaScale;
      targetAreas.set(room, targetArea);
      const completeness = area / targetArea;
      const rounds = completeness < 0.45 ? 3 : completeness < 0.7 ? 2 : 1;
      if (completeness < 0.9) {
        interiorRecoveryRounds.set(
          room,
          Math.max(interiorRecoveryRounds.get(room) ?? 0, rounds),
        );
      }
    }
  }
  const inferred = recoverUnitInteriors(
    graph,
    seeds,
    claimed,
    new Set([...reservedSpaces, ...seedSpaces]),
    circulation,
    interiorRecoveryRounds,
    targetAreas,
  );
  if (inferred.recovered) {
    log(
      `${inferred.recovered} bounded interior space${inferred.recovered === 1 ? "" : "s"} recovered across likely flattened partitions`,
    );
  }
  if (inferred.contested) {
    log(
      `${inferred.contested} inferred interior space${inferred.contested === 1 ? "" : "s"} contested by multiple units and left unassigned`,
    );
  }
  const peeled = peelCirculation(graph, claimed, rounds, circulation);
  if (peeled) {
    log(
      `${peeled} space${peeled === 1 ? "" : "s"} opening wide onto a hallway handed back to circulation`,
    );
  }

  const owner = new Map<number, number>();
  const roomAreas = new Map<number, number>();
  for (const [spaceId, room] of claimed) {
    const space = graph.spaces[spaceId]!;
    for (const faceId of space.faceIds) owner.set(faceId, room);
    roomAreas.set(room, (roomAreas.get(room) ?? 0) + space.area);
  }
  const blocked = new Set(
    [...circulation].flatMap((id) => graph.spaces[id]!.faceIds),
  );
  absorbOrphans(graph, owner, blocked, roomAreas);

  const rooms = finishRooms(
    graph,
    seeds,
    owner,
    log,
    options.closeDistance ?? GLOBAL_FACE_CLOSE_DISTANCE,
  );
  for (const room of rooms) {
    const spaces = new Set(room.faceIds.map((id) => graph.faces[id]!.space));
    log(
      `${room.name}: ${spaces.size} space${spaces.size === 1 ? "" : "s"}, ${room.shape.points.length} corners`,
    );
  }
  return rooms;
}

type LocalFrame = {
  angle: number;
  origin: RoomPoint;
  xScale: number;
  yScale: number;
};

function framePoint(frame: LocalFrame, point: RoomPoint): RoomPoint {
  const x = point.x * frame.xScale - frame.origin.x;
  const y = point.y * frame.yScale - frame.origin.y;
  const cos = Math.cos(frame.angle);
  const sin = Math.sin(frame.angle);
  return { x: x * cos + y * sin, y: -x * sin + y * cos };
}

function unframePoint(frame: LocalFrame, point: RoomPoint): RoomPoint {
  const cos = Math.cos(frame.angle);
  const sin = Math.sin(frame.angle);
  const x = point.x * cos - point.y * sin + frame.origin.x;
  const y = point.x * sin + point.y * cos + frame.origin.y;
  return { x: x / frame.xScale, y: y / frame.yScale };
}

function seedPhysicalAngle(seed: PdfRoomSeed, xScale: number, yScale: number) {
  const [start, end] = seed.anchors ?? [];
  if (!start || !end) return null;
  let angle = Math.atan2(
    (end.y - start.y) * yScale,
    (end.x - start.x) * xScale,
  );
  while (angle < 0) angle += Math.PI;
  while (angle >= Math.PI) angle -= Math.PI;
  return angle;
}

function axisDistance(angle: number) {
  return Math.min(angle, Math.abs(angle - Math.PI / 2), Math.PI - angle);
}

type AxisSupport = {
  coordinate: number;
  intervals: Array<[number, number]>;
};

function intervalCoverage(support: AxisSupport, start: number, end: number) {
  const intervals = support.intervals
    .map(
      ([left, right]) =>
        [Math.max(start, left), Math.min(end, right)] as [number, number],
    )
    .filter(([left, right]) => right > left)
    .sort(([left], [right]) => left - right);
  let covered = 0;
  let cursorStart = 0;
  let cursorEnd = 0;
  let active = false;
  for (const [left, right] of intervals) {
    if (!active || left > cursorEnd) {
      if (active) covered += cursorEnd - cursorStart;
      cursorStart = left;
      cursorEnd = right;
      active = true;
    } else {
      cursorEnd = Math.max(cursorEnd, right);
    }
  }
  if (active) covered += cursorEnd - cursorStart;
  return end > start ? covered / (end - start) : 0;
}

function mergeAxisSupports(walls: LineSegment[], wallThickness: number) {
  const horizontal: AxisSupport[] = [];
  const vertical: AxisSupport[] = [];
  for (const [[x1, y1], [x2, y2]] of walls) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    if (length < GRID * 6) continue;
    let angle = Math.atan2(dy, dx);
    while (angle < 0) angle += Math.PI;
    while (angle >= Math.PI) angle -= Math.PI;
    if (axisDistance(angle) > Math.PI / 90) continue;
    if (Math.abs(dx) >= Math.abs(dy)) {
      horizontal.push({
        coordinate: (y1 + y2) / 2,
        intervals: [[Math.min(x1, x2), Math.max(x1, x2)]],
      });
    } else {
      vertical.push({
        coordinate: (x1 + x2) / 2,
        intervals: [[Math.min(y1, y2), Math.max(y1, y2)]],
      });
    }
  }
  const merge = (supports: AxisSupport[]) => {
    const tolerance = Math.max(GRID * 2, wallThickness);
    const merged: AxisSupport[] = [];
    for (const support of supports.sort(
      (left, right) => left.coordinate - right.coordinate,
    )) {
      const previous = merged[merged.length - 1];
      if (!previous || support.coordinate - previous.coordinate > tolerance) {
        merged.push({
          coordinate: support.coordinate,
          intervals: [...support.intervals],
        });
        continue;
      }
      const previousWeight = previous.intervals.length;
      const supportWeight = support.intervals.length;
      previous.coordinate =
        (previous.coordinate * previousWeight +
          support.coordinate * supportWeight) /
        (previousWeight + supportWeight);
      previous.intervals.push(...support.intervals);
    }
    return merged;
  };
  return { horizontal: merge(horizontal), vertical: merge(vertical) };
}

/**
 * Recover a suite perimeter from independent source-wall runs when the local
 * ownership graph is incomplete. Candidates may be rectangular or contain up
 * to two supported corner returns. Wall continuity is primary; printed area
 * is a bounded secondary signal because sheet-wide calibration is noisy.
 */
function wallSupportedUnitCell(
  seed: RoomPoint,
  targetArea: number,
  otherSeeds: RoomPoint[],
  walls: LineSegment[],
  wallThickness: number,
  ownedFaces: Array<Pick<FloorFace, "bbox" | "shape">> = [],
  options: {
    maxAreaError?: number;
    scoreAreaWeight?: number;
    maxOwnershipError?: number;
  } = {},
  log: Logger = () => undefined,
) {
  if (targetArea <= 0) return null;
  const maxAreaError = options.maxAreaError ?? 0.15;
  const scoreAreaWeight = options.scoreAreaWeight ?? 2;
  const maxOwnershipError = options.maxOwnershipError ?? 1;
  const span = Math.sqrt(targetArea);
  const { horizontal, vertical } = mergeAxisSupports(walls, wallThickness);
  const supportLength = (support: AxisSupport) =>
    support.intervals.reduce((sum, [start, end]) => sum + end - start, 0);
  const onSide = (
    supports: AxisSupport[],
    direction: "before" | "after",
    coordinate: number,
  ) =>
    supports
      .filter(
        (support) =>
          (direction === "before"
            ? support.coordinate < coordinate
            : support.coordinate > coordinate) &&
          Math.abs(support.coordinate - coordinate) <= span * 1.6 &&
          supportLength(support) >= span * 0.25,
      )
      .sort(
        (left, right) =>
          Math.abs(left.coordinate - coordinate) -
          Math.abs(right.coordinate - coordinate),
      )
      .slice(0, 40);
  const left = onSide(vertical, "before", seed.x);
  const right = onSide(vertical, "after", seed.x);
  const top = onSide(horizontal, "before", seed.y);
  const bottom = onSide(horizontal, "after", seed.y);
  const candidates: Array<{
    points: RoomPoint[];
    score: number;
    strictScore: number;
    areaError: number;
    supportError: number;
    ownershipError: number;
  }> = [];
  const ownedSamples = ownedFaces.map((face) => {
    const center = {
      x: face.bbox.x + face.bbox.w / 2,
      y: face.bbox.y + face.bbox.h / 2,
    };
    return {
      area: Math.abs(polygonArea(face.shape.points)),
      points: [
        center,
        ...face.shape.points.map((point) => ({
          x: point.x * 0.85 + center.x * 0.15,
          y: point.y * 0.85 + center.y * 0.15,
        })),
      ].filter((point) => faceContains(face, point)),
    };
  });
  const ownedArea = ownedSamples.reduce((sum, face) => sum + face.area, 0);
  const consider = (points: RoomPoint[], sideSupports: AxisSupport[]) => {
    const area = Math.abs(polygonArea(points));
    const areaError = Math.abs(area - targetArea) / targetArea;
    if (areaError > maxAreaError) return;
    const shape = { type: "polygon", points } as RoomPolygonShape;
    if (!pointInPolygon(seed, shape)) return;
    const foreignInside = otherSeeds.filter((other) => {
      if (
        Math.hypot(other.x - seed.x, other.y - seed.y) <= GRID ||
        !pointInPolygon(other, shape)
      ) {
        return false;
      }
      const boundaryDistance = Math.min(
        ...points.map((start, index) =>
          pointToSegmentDistance(
            other,
            start,
            points[(index + 1) % points.length]!,
          ),
        ),
      );
      return boundaryDistance > Math.max(GRID * 2, wallThickness * 2);
    });
    if (foreignInside.length) {
      return;
    }
    const coveredOwnedArea = ownedSamples.reduce((sum, face) => {
      const covered = face.points.filter((point) =>
        pointInPolygon(point, shape),
      );
      return (
        sum +
        (face.points.length ? covered.length / face.points.length : 0) *
          face.area
      );
    }, 0);
    const ownershipError = ownedArea > 0 ? 1 - coveredOwnedArea / ownedArea : 0;
    if (ownershipError > maxOwnershipError) return;
    const coverage = points.map((start, index) => {
      const end = points[(index + 1) % points.length]!;
      return intervalCoverage(
        sideSupports[index]!,
        Math.min(
          Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
            ? start.x
            : start.y,
          Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
            ? end.x
            : end.y,
        ),
        Math.max(
          Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
            ? start.x
            : start.y,
          Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
            ? end.x
            : end.y,
        ),
      );
    });
    if (coverage.some((value) => value < 0.5)) {
      return;
    }
    const supportError = coverage.reduce((sum, value) => sum + (1 - value), 0);
    candidates.push({
      points,
      score: areaError * scoreAreaWeight + supportError + ownershipError,
      strictScore:
        areaError * scoreAreaWeight * 2 + supportError + ownershipError,
      areaError,
      supportError,
      ownershipError,
    });
  };
  for (const leftWall of left) {
    for (const rightWall of right) {
      for (const topWall of top) {
        for (const bottomWall of bottom) {
          const width = rightWall.coordinate - leftWall.coordinate;
          const height = bottomWall.coordinate - topWall.coordinate;
          const area = width * height;
          consider(
            [
              { x: leftWall.coordinate, y: topWall.coordinate },
              { x: rightWall.coordinate, y: topWall.coordinate },
              { x: rightWall.coordinate, y: bottomWall.coordinate },
              { x: leftWall.coordinate, y: bottomWall.coordinate },
            ],
            [topWall, rightWall, bottomWall, leftWall],
          );
          // Returned suites may have a large bounding rectangle even though
          // their source-supported polygon is close to the printed area.
          // `consider` applies the area bound after the return is removed.
          if (area < targetArea * 0.9) continue;
          const notchVerticals = vertical.filter(
            (support) =>
              support.coordinate > leftWall.coordinate + GRID &&
              support.coordinate < rightWall.coordinate - GRID &&
              supportLength(support) >= span * 0.2,
          );
          const notchHorizontals = horizontal.filter(
            (support) =>
              support.coordinate > topWall.coordinate + GRID &&
              support.coordinate < bottomWall.coordinate - GRID &&
              supportLength(support) >= span * 0.2,
          );
          type CornerReturn = {
            vertical: AxisSupport;
            horizontal: AxisSupport;
          };
          const supportReaches = (support: AxisSupport, coordinate: number) =>
            support.intervals.some(
              ([start, end]) =>
                coordinate >= start - wallThickness * 2 &&
                coordinate <= end + wallThickness * 2,
            );
          const corners = {
            topLeft: [] as CornerReturn[],
            topRight: [] as CornerReturn[],
            bottomRight: [] as CornerReturn[],
            bottomLeft: [] as CornerReturn[],
          };
          // Cheap optimistic bound before pairing supports. It deliberately
          // overestimates removable area, so it can only discard outer boxes
          // that no supported one/two-return perimeter could shrink enough.
          const minimumInnerX = Math.min(
            ...notchVerticals.map((support) => support.coordinate),
          );
          const maximumInnerX = Math.max(
            ...notchVerticals.map((support) => support.coordinate),
          );
          const minimumInnerY = Math.min(
            ...notchHorizontals.map((support) => support.coordinate),
          );
          const maximumInnerY = Math.max(
            ...notchHorizontals.map((support) => support.coordinate),
          );
          const maximumVerticalReturn =
            Number.isFinite(minimumInnerY) && Number.isFinite(maximumInnerY)
              ? maximumInnerY -
                topWall.coordinate +
                bottomWall.coordinate -
                minimumInnerY
              : 0;
          const maximumReturnArea = Math.max(
            Number.isFinite(maximumInnerX)
              ? (maximumInnerX - leftWall.coordinate) * maximumVerticalReturn
              : 0,
            Number.isFinite(minimumInnerX)
              ? (rightWall.coordinate - minimumInnerX) * maximumVerticalReturn
              : 0,
          );
          if (area - maximumReturnArea > targetArea * 1.15) continue;
          for (const notchVertical of notchVerticals) {
            for (const notchHorizontal of notchHorizontals) {
              const x = notchVertical.coordinate;
              const y = notchHorizontal.coordinate;
              const joined =
                supportReaches(notchVertical, y) &&
                supportReaches(notchHorizontal, x);
              if (joined) {
                if (
                  supportReaches(notchVertical, topWall.coordinate) &&
                  supportReaches(notchHorizontal, leftWall.coordinate)
                )
                  corners.topLeft.push({
                    vertical: notchVertical,
                    horizontal: notchHorizontal,
                  });
                if (
                  supportReaches(notchVertical, topWall.coordinate) &&
                  supportReaches(notchHorizontal, rightWall.coordinate)
                )
                  corners.topRight.push({
                    vertical: notchVertical,
                    horizontal: notchHorizontal,
                  });
                if (
                  supportReaches(notchVertical, bottomWall.coordinate) &&
                  supportReaches(notchHorizontal, rightWall.coordinate)
                )
                  corners.bottomRight.push({
                    vertical: notchVertical,
                    horizontal: notchHorizontal,
                  });
                if (
                  supportReaches(notchVertical, bottomWall.coordinate) &&
                  supportReaches(notchHorizontal, leftWall.coordinate)
                )
                  corners.bottomLeft.push({
                    vertical: notchVertical,
                    horizontal: notchHorizontal,
                  });
              }
              consider(
                [
                  { x: leftWall.coordinate, y: topWall.coordinate },
                  { x: rightWall.coordinate, y: topWall.coordinate },
                  { x: rightWall.coordinate, y },
                  { x, y },
                  { x, y: bottomWall.coordinate },
                  { x: leftWall.coordinate, y: bottomWall.coordinate },
                ],
                [
                  topWall,
                  rightWall,
                  notchHorizontal,
                  notchVertical,
                  bottomWall,
                  leftWall,
                ],
              );
              consider(
                [
                  { x: leftWall.coordinate, y: topWall.coordinate },
                  { x, y: topWall.coordinate },
                  { x, y },
                  { x: rightWall.coordinate, y },
                  { x: rightWall.coordinate, y: bottomWall.coordinate },
                  { x: leftWall.coordinate, y: bottomWall.coordinate },
                ],
                [
                  topWall,
                  notchVertical,
                  notchHorizontal,
                  rightWall,
                  bottomWall,
                  leftWall,
                ],
              );
              consider(
                [
                  { x: leftWall.coordinate, y },
                  { x, y },
                  { x, y: topWall.coordinate },
                  { x: rightWall.coordinate, y: topWall.coordinate },
                  { x: rightWall.coordinate, y: bottomWall.coordinate },
                  { x: leftWall.coordinate, y: bottomWall.coordinate },
                ],
                [
                  notchHorizontal,
                  notchVertical,
                  topWall,
                  rightWall,
                  bottomWall,
                  leftWall,
                ],
              );
              consider(
                [
                  { x: leftWall.coordinate, y: topWall.coordinate },
                  { x: rightWall.coordinate, y: topWall.coordinate },
                  { x: rightWall.coordinate, y: bottomWall.coordinate },
                  { x, y: bottomWall.coordinate },
                  { x, y },
                  { x: leftWall.coordinate, y },
                ],
                [
                  topWall,
                  rightWall,
                  bottomWall,
                  notchVertical,
                  notchHorizontal,
                  leftWall,
                ],
              );
            }
          }

          // Pair only source runs that physically meet both each other and the
          // corresponding outer wall. This keeps the two-notch search bounded
          // and prevents unrelated interior partitions from combining.
          for (const topRight of corners.topRight) {
            for (const bottomRight of corners.bottomRight) {
              const x1 = topRight.vertical.coordinate;
              const y1 = topRight.horizontal.coordinate;
              const x2 = bottomRight.vertical.coordinate;
              const y2 = bottomRight.horizontal.coordinate;
              if (y1 + GRID >= y2) continue;
              consider(
                [
                  { x: leftWall.coordinate, y: topWall.coordinate },
                  { x: x1, y: topWall.coordinate },
                  { x: x1, y: y1 },
                  { x: rightWall.coordinate, y: y1 },
                  { x: rightWall.coordinate, y: y2 },
                  { x: x2, y: y2 },
                  { x: x2, y: bottomWall.coordinate },
                  { x: leftWall.coordinate, y: bottomWall.coordinate },
                ],
                [
                  topWall,
                  topRight.vertical,
                  topRight.horizontal,
                  rightWall,
                  bottomRight.horizontal,
                  bottomRight.vertical,
                  bottomWall,
                  leftWall,
                ],
              );
            }
          }
          for (const topLeft of corners.topLeft) {
            for (const bottomLeft of corners.bottomLeft) {
              const x1 = topLeft.vertical.coordinate;
              const y1 = topLeft.horizontal.coordinate;
              const x2 = bottomLeft.vertical.coordinate;
              const y2 = bottomLeft.horizontal.coordinate;
              if (y1 + GRID >= y2) continue;
              consider(
                [
                  { x: x1, y: topWall.coordinate },
                  { x: rightWall.coordinate, y: topWall.coordinate },
                  { x: rightWall.coordinate, y: bottomWall.coordinate },
                  { x: x2, y: bottomWall.coordinate },
                  { x: x2, y: y2 },
                  { x: leftWall.coordinate, y: y2 },
                  { x: leftWall.coordinate, y: y1 },
                  { x: x1, y: y1 },
                ],
                [
                  topWall,
                  rightWall,
                  bottomWall,
                  bottomLeft.vertical,
                  bottomLeft.horizontal,
                  leftWall,
                  topLeft.horizontal,
                  topLeft.vertical,
                ],
              );
            }
          }
        }
      }
    }
  }
  const ranked = candidates
    .sort((left, right) => left.score - right.score)
    .filter(
      (candidate, index, all) =>
        !all
          .slice(0, index)
          .some(
            (other) =>
              candidate.points.length === other.points.length &&
              candidate.points.every(
                (point, pointIndex) =>
                  Math.hypot(
                    point.x - other.points[pointIndex]!.x,
                    point.y - other.points[pointIndex]!.y,
                  ) <= Math.max(GRID * 6, wallThickness * 4),
              ),
          ),
    );
  const best = ranked[0];
  const runnerUp = ranked[1];
  const strictRanked = [...ranked].sort(
    (left, right) => left.strictScore - right.strictScore,
  );
  const strictBest = strictRanked[0];
  const strictRunnerUp = strictRanked[1];
  if (process.env.ROOM_WALL_CANDIDATE_DEBUG === "1") {
    ranked
      .slice(0, 40)
      .forEach((candidate, index) =>
        log(
          `wall-cell rank=${index + 1} edges=${candidate.points.length} score=${candidate.score.toFixed(3)} strict=${candidate.strictScore.toFixed(3)} area-error=${candidate.areaError.toFixed(3)} support-error=${candidate.supportError.toFixed(3)} owner-error=${candidate.ownershipError.toFixed(3)} points=${JSON.stringify(candidate.points)}`,
        ),
      );
  }
  const confidentRectangle =
    best?.points.length === 4 &&
    best === strictBest &&
    best.strictScore <= 1.1 &&
    (!strictRunnerUp || strictRunnerUp.strictScore - best.strictScore >= 0.2);
  const strictlyConfidentSteppedCell =
    best &&
    (best.points.length === 6 || best.points.length === 8) &&
    best === strictBest &&
    best.strictScore <= 1.2 &&
    (!strictRunnerUp || strictRunnerUp.strictScore - best.strictScore >= 0.2);
  const connectivityOverride =
    best &&
    strictBest &&
    (best.points.length === 6 || best.points.length === 8) &&
    strictBest.points.length === 4 &&
    best !== strictBest &&
    best.areaError <= 0.12 &&
    strictBest.areaError <= 0.12 &&
    best.supportError + 0.12 <= strictBest.supportError &&
    strictBest.score - best.score >= 0.05;
  const wallEvidenceOverride =
    best &&
    best.points.length <= 12 &&
    best.areaError <=
      Math.min(maxAreaError, options.maxAreaError ? 0.6 : 0.12) &&
    best.supportError / best.points.length <= 0.22;
  if (best) {
    log(
      `wall-cell candidates=${ranked.length} best=${best.points.length} edges score=${best.score.toFixed(3)} owner-error=${best.ownershipError.toFixed(3)}${runnerUp ? ` margin=${(runnerUp.score - best.score).toFixed(3)}` : ""}`,
    );
  }
  return best &&
    (confidentRectangle ||
      strictlyConfidentSteppedCell ||
      connectivityOverride ||
      wallEvidenceOverride)
    ? ({ type: "polygon", points: best.points } as RoomPolygonShape)
    : null;
}

function localGridOutline(
  faces: FloorFace[],
  closeDistance: number,
  blockers: Array<Pick<FloorFace, "bbox" | "shape">> = [],
  walls: LineSegment[] = [],
) {
  if (faces.length === 0) return null;
  const step = GRID;
  const radius = Math.max(1, Math.ceil(closeDistance / step));
  const padding = radius + 3;
  const left = Math.min(...faces.map((face) => face.bbox.x)) - padding * step;
  const top = Math.min(...faces.map((face) => face.bbox.y)) - padding * step;
  const right =
    Math.max(...faces.map((face) => face.bbox.x + face.bbox.w)) +
    padding * step;
  const bottom =
    Math.max(...faces.map((face) => face.bbox.y + face.bbox.h)) +
    padding * step;
  const width = Math.ceil((right - left) / step);
  const height = Math.ceil((bottom - top) / step);
  if (width < 1 || height < 1 || width * height > 2_000_000) return null;
  const index = (column: number, row: number) => row * width + column;
  const occupied = new Uint8Array(width * height);
  const blocked = new Uint8Array(width * height);
  const rasterize = (
    inputFaces: Array<Pick<FloorFace, "bbox" | "shape">>,
    output: Uint8Array,
  ) => {
    for (const face of inputFaces) {
      const firstColumn = Math.max(0, Math.floor((face.bbox.x - left) / step));
      const lastColumn = Math.min(
        width - 1,
        Math.ceil((face.bbox.x + face.bbox.w - left) / step),
      );
      const firstRow = Math.max(0, Math.floor((face.bbox.y - top) / step));
      const lastRow = Math.min(
        height - 1,
        Math.ceil((face.bbox.y + face.bbox.h - top) / step),
      );
      for (let row = firstRow; row <= lastRow; row += 1) {
        for (let column = firstColumn; column <= lastColumn; column += 1) {
          const point = {
            x: left + (column + 0.5) * step,
            y: top + (row + 0.5) * step,
          };
          if (faceContains(face, point)) output[index(column, row)] = 1;
        }
      }
    }
  };
  rasterize(faces, occupied);
  rasterize(blockers, blocked);
  const dilated = new Uint8Array(occupied.length);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (blocked[index(column, row)]) continue;
      let found = false;
      for (let dy = -radius; dy <= radius && !found; dy += 1) {
        const y = row + dy;
        if (y < 0 || y >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const x = column + dx;
          if (x >= 0 && x < width && occupied[index(x, y)]) {
            found = true;
            break;
          }
        }
      }
      if (found) dilated[index(column, row)] = 1;
    }
  }
  const closed = new Uint8Array(occupied.length);
  for (let row = radius; row < height - radius; row += 1) {
    for (let column = radius; column < width - radius; column += 1) {
      let filled = true;
      for (let dy = -radius; dy <= radius && filled; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (!dilated[index(column + dx, row + dy)]) {
            filled = false;
            break;
          }
        }
      }
      if (filled) closed[index(column, row)] = 1;
    }
  }

  type GridPoint = { column: number; row: number };
  const key = (point: GridPoint) => `${point.column},${point.row}`;
  const edges = new Map<string, GridPoint[]>();
  const addEdge = (start: GridPoint, end: GridPoint) => {
    const list = edges.get(key(start)) ?? [];
    list.push(end);
    edges.set(key(start), list);
  };
  const has = (column: number, row: number) =>
    column >= 0 && column < width && row >= 0 && row < height
      ? closed[index(column, row)] === 1
      : false;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (!has(column, row)) continue;
      if (!has(column, row - 1))
        addEdge({ column, row }, { column: column + 1, row });
      if (!has(column + 1, row))
        addEdge(
          { column: column + 1, row },
          { column: column + 1, row: row + 1 },
        );
      if (!has(column, row + 1))
        addEdge({ column: column + 1, row: row + 1 }, { column, row: row + 1 });
      if (!has(column - 1, row))
        addEdge({ column, row: row + 1 }, { column, row });
    }
  }
  const rings: RoomPoint[][] = [];
  while (edges.size) {
    const [startKey, firstEnds] = edges.entries().next().value as [
      string,
      GridPoint[],
    ];
    const [startColumn, startRow] = startKey.split(",").map(Number) as [
      number,
      number,
    ];
    const start = { column: startColumn, row: startRow };
    const ring: GridPoint[] = [start];
    const first = firstEnds.pop();
    if (firstEnds.length === 0) edges.delete(startKey);
    if (!first) continue;
    let previous = start;
    let current = first;
    for (let count = 0; count < width * height * 4; count += 1) {
      if (key(current) === startKey) break;
      ring.push(current);
      const currentKey = key(current);
      const ends = edges.get(currentKey);
      if (!ends) break;
      const incoming = {
        x: current.column - previous.column,
        y: current.row - previous.row,
      };
      const ranked = ends
        .map((end, endIndex) => {
          const outgoing = {
            x: end.column - current.column,
            y: end.row - current.row,
          };
          const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
          const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
          const turn = cross > 0 ? 3 : dot > 0 ? 2 : cross < 0 ? 1 : 0;
          return { end, endIndex, turn };
        })
        .sort((left, right) => right.turn - left.turn);
      const choice = ranked[0];
      if (!choice) break;
      const next = choice.end;
      ends.splice(choice.endIndex, 1);
      if (ends.length === 0) edges.delete(currentKey);
      previous = current;
      current = next;
    }
    if (ring.length >= 4 && key(current) === startKey) {
      rings.push(
        ring.map((point) => ({
          x: left + point.column * step,
          y: top + point.row * step,
        })),
      );
    }
  }
  const outline = rings.sort(
    (a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)),
  )[0];
  if (!outline) return null;
  const crossesWall = (start: RoomPoint, end: RoomPoint) => {
    const rx = end.x - start.x;
    const ry = end.y - start.y;
    return walls.some(([[x1, y1], [x2, y2]]) => {
      const sx = x2 - x1;
      const sy = y2 - y1;
      const denominator = rx * sy - ry * sx;
      if (Math.abs(denominator) < 1e-9) return false;
      const qx = x1 - start.x;
      const qy = y1 - start.y;
      const alongRoom = (qx * sy - qy * sx) / denominator;
      const alongWall = (qx * ry - qy * rx) / denominator;
      return (
        alongRoom > 0.02 &&
        alongRoom < 0.98 &&
        alongWall > 0.02 &&
        alongWall < 0.98
      );
    });
  };
  const simplifyOpen = (
    points: RoomPoint[],
    tolerance: number,
  ): RoomPoint[] => {
    if (points.length <= 2) return points;
    const start = points[0]!;
    const end = points[points.length - 1]!;
    let farthest = -1;
    let distance = tolerance;
    for (let index = 1; index < points.length - 1; index += 1) {
      const candidate = pointToSegmentDistance(points[index]!, start, end);
      if (candidate > distance) {
        distance = candidate;
        farthest = index;
      }
    }
    if (farthest < 0) {
      const localAxisAligned =
        Math.abs(start.x - end.x) <= tolerance ||
        Math.abs(start.y - end.y) <= tolerance;
      if (localAxisAligned && !crossesWall(start, end)) return [start, end];
      farthest = Math.floor(points.length / 2);
    }
    return [
      ...simplifyOpen(points.slice(0, farthest + 1), tolerance).slice(0, -1),
      ...simplifyOpen(points.slice(farthest), tolerance),
    ];
  };
  let split = 1;
  let farthest = 0;
  for (let index = 1; index < outline.length; index += 1) {
    const distance = Math.hypot(
      outline[index]!.x - outline[0]!.x,
      outline[index]!.y - outline[0]!.y,
    );
    if (distance > farthest) {
      farthest = distance;
      split = index;
    }
  }
  const simplifyTolerance = Math.max(step * 1.2, closeDistance);
  const firstHalf = simplifyOpen(
    outline.slice(0, split + 1),
    simplifyTolerance,
  );
  const secondHalf = simplifyOpen(
    [...outline.slice(split), outline[0]!],
    simplifyTolerance,
  );
  const simplified = [...firstHalf.slice(0, -1), ...secondHalf.slice(0, -1)];
  return simplified.length >= 3
    ? ({ type: "polygon", points: simplified } as RoomPolygonShape)
    : null;
}

/**
 * Trace rotated unit wings in their own isotropic PDF frame. The page-wide
 * graph remains the fallback and continues to serve click-to-grow. Only a
 * spatially connected cluster of three or more consistently rotated unit
 * labels activates a local pass, so ordinary axis-aligned floors are
 * unchanged. Final polygons are inverse-transformed exactly to normalized
 * page coordinates.
 */
function locallyAlignedUnitRooms(
  linework: FloorLinework,
  seeds: PdfRoomSeed[],
  graph: FloorGraph,
  globalRooms: AssignedRoom[],
  log: Logger,
) {
  if (!linework.pageWidth || !linework.pageHeight)
    return new Map<number, AssignedRoom>();
  const longest = Math.max(linework.pageWidth, linework.pageHeight);
  const xScale = linework.pageWidth / longest;
  const yScale = linework.pageHeight / longest;
  const unitAreaScale = median(
    globalRooms.flatMap((room) => {
      const seed = seeds.find(
        (candidate) =>
          candidate.kind === "unit" &&
          candidate.name === room.name &&
          Math.hypot(candidate.x - room.seed.x, candidate.y - room.seed.y) <
            GRID,
      );
      if (!seed?.areaSqFt) return [];
      const area = room.faceIds.reduce(
        (sum, faceId) => sum + graph.faces[faceId]!.area * xScale * yScale,
        0,
      );
      return area > 0 ? [area / seed.areaSqFt] : [];
    }),
  );
  const angled = seeds.flatMap((seed, index) => {
    if (seed.kind !== "unit") return [];
    const angle = seedPhysicalAngle(seed, xScale, yScale);
    return angle !== null && axisDistance(angle) >= Math.PI / 36
      ? [{ seed, index, angle }]
      : [];
  });
  const remaining = new Set(angled.map((_, index) => index));
  const clusters: (typeof angled)[] = [];
  while (remaining.size) {
    const first = remaining.values().next().value as number;
    remaining.delete(first);
    const cluster = [angled[first]!];
    const queue = [angled[first]!];
    while (queue.length) {
      const current = queue.pop()!;
      for (const candidateIndex of [...remaining]) {
        const candidate = angled[candidateIndex]!;
        const sameAxis =
          Math.abs(candidate.angle - current.angle) <= Math.PI / 60;
        const near =
          Math.hypot(
            (candidate.seed.x - current.seed.x) * xScale,
            (candidate.seed.y - current.seed.y) * yScale,
          ) <= 0.14;
        if (!sameAxis || !near) continue;
        remaining.delete(candidateIndex);
        cluster.push(candidate);
        queue.push(candidate);
      }
    }
    if (cluster.length >= 3) clusters.push(cluster);
  }

  const replacements = new Map<number, AssignedRoom>();
  for (const cluster of clusters) {
    const angle = median(cluster.map((item) => item.angle));
    const origin = {
      x: median(cluster.map((item) => item.seed.x * xScale)),
      y: median(cluster.map((item) => item.seed.y * yScale)),
    };
    const frame = { angle, origin, xScale, yScale };
    const transformedCluster = cluster.map((item) =>
      framePoint(frame, item.seed),
    );
    const minX = Math.min(...transformedCluster.map((point) => point.x)) - 0.12;
    const maxX = Math.max(...transformedCluster.map((point) => point.x)) + 0.12;
    const minY = Math.min(...transformedCluster.map((point) => point.y)) - 0.12;
    const maxY = Math.max(...transformedCluster.map((point) => point.y)) + 0.12;
    const transformSegment = (segment: WallSegment): WallSegment => {
      const start = framePoint(frame, { x: segment.x1, y: segment.y1 });
      const end = framePoint(frame, { x: segment.x2, y: segment.y2 });
      return { ...segment, x1: start.x, y1: start.y, x2: end.x, y2: end.y };
    };
    const overlapsCrop = (segment: WallSegment) =>
      Math.max(segment.x1, segment.x2) >= minX &&
      Math.min(segment.x1, segment.x2) <= maxX &&
      Math.max(segment.y1, segment.y2) >= minY &&
      Math.min(segment.y1, segment.y2) <= maxY;
    const segments = linework.segments
      .map(transformSegment)
      .filter(overlapsCrop);
    const arcs = linework.arcs.map(transformSegment).filter(overlapsCrop);
    const localStrongWalls = buildWallLinework(segments).strong;
    const localGraph = buildFloorGraph(
      { ...linework, segments, arcs },
      { log },
    );
    const localSeeds = seeds
      .map((seed) => ({
        ...seed,
        ...framePoint(frame, seed),
        anchors: seed.anchors?.map((point) => framePoint(frame, point)),
      }))
      .filter(
        (seed) =>
          seed.x >= minX && seed.x <= maxX && seed.y >= minY && seed.y <= maxY,
      );
    const localSeedWallDistances = localSeeds.map((seed) => {
      const distances = localGraph.faces.map(() => Number.POSITIVE_INFINITY);
      const pathLengths = localGraph.faces.map(() => Number.POSITIVE_INFINITY);
      const queue: number[] = [];
      const directFaces = facesAtPoint(localGraph, seed);
      const startFaces = directFaces.length
        ? directFaces
        : (spaceNearPoint(localGraph, seed)?.faceIds.map(
            (faceId) => localGraph.faces[faceId]!,
          ) ?? []);
      for (const face of startFaces) {
        distances[face.id] = 0;
        pathLengths[face.id] = 0;
        queue.push(face.id);
      }
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const faceId = queue[cursor]!;
        const distance = distances[faceId]!;
        for (const neighbor of localGraph.faces[faceId]!.neighbors) {
          const passable =
            neighbor.doorLength >= MIN_PASS_LENGTH ||
            neighbor.openLength >= MIN_PASS_LENGTH;
          const nextDistance = distance + (passable ? 0 : 1);
          const nextPathLength =
            pathLengths[faceId]! +
            Math.hypot(
              localGraph.faces[neighbor.face]!.centroid.x -
                localGraph.faces[faceId]!.centroid.x,
              localGraph.faces[neighbor.face]!.centroid.y -
                localGraph.faces[faceId]!.centroid.y,
            );
          if (
            nextDistance > distances[neighbor.face]! ||
            (nextDistance === distances[neighbor.face]! &&
              nextPathLength >= pathLengths[neighbor.face]!)
          ) {
            continue;
          }
          distances[neighbor.face] = nextDistance;
          pathLengths[neighbor.face] = nextPathLength;
          queue.push(neighbor.face);
        }
      }
      return { seed, distances, pathLengths };
    });
    const directLocalRooms = assignRooms(localGraph, localSeeds, log);
    const localBlockedFaces = new Set(
      directLocalRooms
        .filter((room) => room.kind !== "unit")
        .flatMap((room) => room.faceIds),
    );
    const clusterRooms = new Map<number, AssignedRoom>();
    const globalOwner = new Map<number, number>();
    for (const item of cluster) {
      const room = globalRooms.find(
        (candidate) =>
          candidate.name === item.seed.name &&
          candidate.kind === "unit" &&
          Math.hypot(
            candidate.seed.x - item.seed.x,
            candidate.seed.y - item.seed.y,
          ) < GRID,
      );
      if (!room) continue;
      clusterRooms.set(item.index, room);
      for (const faceId of room.faceIds) globalOwner.set(faceId, item.index);
    }

    // Re-node the walls in the aligned frame, then transfer semantic ownership
    // by mutual face overlap samples. A single centroid is not enough: narrow
    // wall-bounded pieces can straddle a differently noded global face and were
    // being dropped, while unrelated fragments inherited ownership by chance.
    // Each local face receives one owner only, preventing suite overlap before
    // the final union.
    const votes = new Map<number, Map<number, number>>();
    const vote = (localFaceId: number, roomIndex: number, weight: number) => {
      const byRoom = votes.get(localFaceId) ?? new Map<number, number>();
      byRoom.set(roomIndex, (byRoom.get(roomIndex) ?? 0) + weight);
      votes.set(localFaceId, byRoom);
    };
    for (const localFace of localGraph.faces) {
      if (localFace.outside) continue;
      const samplePoints = [
        localFace.centroid,
        ...localFace.shape.points.map((point) => ({
          x: point.x * 0.85 + localFace.centroid.x * 0.15,
          y: point.y * 0.85 + localFace.centroid.y * 0.15,
        })),
      ];
      for (const point of samplePoints) {
        for (const globalFace of facesAtPoint(
          graph,
          unframePoint(frame, point),
        )) {
          const owner = globalOwner.get(globalFace.id);
          if (owner !== undefined) vote(localFace.id, owner, 1);
        }
      }
    }
    for (const [globalFaceId, roomIndex] of globalOwner) {
      const globalFace = graph.faces[globalFaceId]!;
      for (const localFace of facesAtPoint(
        localGraph,
        framePoint(frame, globalFace.centroid),
      )) {
        vote(localFace.id, roomIndex, Math.max(1, globalFace.area / GRID ** 2));
      }
    }
    const localOwner = new Map<number, number>();
    for (const [localFaceId, byRoom] of votes) {
      const ranked = [...byRoom.entries()].sort(
        (left, right) => right[1] - left[1],
      );
      const [winner, runnerUp] = ranked;
      if (!winner || (runnerUp && winner[1] <= runnerUp[1] * 1.05)) continue;
      localOwner.set(localFaceId, winner[0]);
    }
    const confirmedWallCells: Array<{
      owner: number;
      bbox: { x: number; y: number; w: number; h: number };
      shape: FloorFace["shape"];
    }> = [];
    const pendingRasterRooms: Array<{
      item: (typeof cluster)[number];
      room: AssignedRoom;
      localFaces: FloorFace[];
    }> = [];
    for (const item of cluster) {
      const room = clusterRooms.get(item.index);
      if (!room) continue;
      const localSeed = framePoint(frame, item.seed);
      const ownWallDistances = localSeedWallDistances.find(
        ({ seed }) =>
          seed.kind === "unit" &&
          seed.name === item.seed.name &&
          Math.hypot(seed.x - localSeed.x, seed.y - localSeed.y) < GRID,
      );
      const serviceWallDistances = localSeedWallDistances.filter(
        ({ seed }) => seed.kind !== "unit",
      );
      const serviceOwnsFace = (face: FloorFace) => {
        const ownCrossings =
          ownWallDistances?.distances[face.id] ?? Number.POSITIVE_INFINITY;
        const ownPathLength =
          ownWallDistances?.pathLengths[face.id] ?? Number.POSITIVE_INFINITY;
        return serviceWallDistances.some(({ distances, pathLengths }) => {
          const serviceCrossings = distances[face.id]!;
          if (serviceCrossings < ownCrossings) return true;
          if (serviceCrossings > ownCrossings) return false;
          return pathLengths[face.id]! < ownPathLength;
        });
      };
      const serviceTiesOrOwnsFace = (face: FloorFace) => {
        const ownCrossings =
          ownWallDistances?.distances[face.id] ?? Number.POSITIVE_INFINITY;
        const ownPathLength =
          ownWallDistances?.pathLengths[face.id] ?? Number.POSITIVE_INFINITY;
        return serviceWallDistances.some(
          ({ distances, pathLengths }) =>
            distances[face.id]! < ownCrossings ||
            (distances[face.id]! === ownCrossings &&
              pathLengths[face.id]! <= ownPathLength),
        );
      };
      const direct = directLocalRooms.find(
        (candidate) =>
          candidate.name === item.seed.name &&
          candidate.kind === "unit" &&
          Math.hypot(
            candidate.seed.x - localSeed.x,
            candidate.seed.y - localSeed.y,
          ) < GRID,
      );
      const directFaceIds = new Set(direct?.faceIds ?? []);
      const candidateFaces = localGraph.faces.filter(
        (face) =>
          localOwner.get(face.id) === item.index &&
          !localBlockedFaces.has(face.id) &&
          (directFaceIds.has(face.id) || !serviceOwnsFace(face)),
      );
      const candidateIds = new Set(candidateFaces.map((face) => face.id));
      const selectedIds = new Set(
        direct?.faceIds.filter((faceId) => candidateIds.has(faceId)) ?? [],
      );
      if (selectedIds.size === 0) {
        const startingFace =
          candidateFaces.find((face) => faceContains(face, localSeed)) ??
          [...candidateFaces].sort(
            (left, right) =>
              Math.hypot(
                left.centroid.x - localSeed.x,
                left.centroid.y - localSeed.y,
              ) -
              Math.hypot(
                right.centroid.x - localSeed.x,
                right.centroid.y - localSeed.y,
              ),
          )[0];
        if (startingFace) selectedIds.add(startingFace.id);
      }
      const targetArea = (item.seed.areaSqFt ?? 0) * unitAreaScale;
      let selectedArea = [...selectedIds].reduce(
        (sum, faceId) => sum + localGraph.faces[faceId]!.area,
        0,
      );
      while (targetArea > 0 && selectedArea < targetArea * 1.05) {
        const frontier = candidateFaces
          .filter(
            (face) =>
              !selectedIds.has(face.id) &&
              face.neighbors.some(
                (neighbor) =>
                  selectedIds.has(neighbor.face) &&
                  (!serviceTiesOrOwnsFace(face) ||
                    neighbor.doorLength >= MIN_PASS_LENGTH ||
                    neighbor.openLength >= MIN_PASS_LENGTH),
              ),
          )
          .map((face) => ({
            face,
            shared: face.neighbors
              .filter(
                (neighbor) =>
                  selectedIds.has(neighbor.face) &&
                  (!serviceTiesOrOwnsFace(face) ||
                    neighbor.doorLength >= MIN_PASS_LENGTH ||
                    neighbor.openLength >= MIN_PASS_LENGTH),
              )
              .reduce((sum, neighbor) => sum + neighbor.length, 0),
          }))
          .sort(
            (left, right) =>
              right.shared - left.shared || right.face.area - left.face.area,
          );
        let next = frontier.find(
          ({ face }) => selectedArea + face.area <= targetArea * 1.2,
        );
        if (!next && selectedIds.size > 0) {
          const selectedFaces = [...selectedIds].map(
            (faceId) => localGraph.faces[faceId]!,
          );
          const closestConnector = (left: FloorFace, right: FloorFace) => {
            const candidates: Array<{
              from: RoomPoint;
              to: RoomPoint;
              gap: number;
            }> = [];
            const consider = (
              from: RoomPoint,
              edgeStart: RoomPoint,
              edgeEnd: RoomPoint,
            ) => {
              const dx = edgeEnd.x - edgeStart.x;
              const dy = edgeEnd.y - edgeStart.y;
              const lengthSquared = dx * dx + dy * dy;
              const along =
                lengthSquared === 0
                  ? 0
                  : Math.max(
                      0,
                      Math.min(
                        1,
                        ((from.x - edgeStart.x) * dx +
                          (from.y - edgeStart.y) * dy) /
                          lengthSquared,
                      ),
                    );
              const to = {
                x: edgeStart.x + along * dx,
                y: edgeStart.y + along * dy,
              };
              const gap = Math.hypot(to.x - from.x, to.y - from.y);
              candidates.push({ from, to, gap });
            };
            for (const point of left.shape.points) {
              right.shape.points.forEach((start, index) =>
                consider(
                  point,
                  start,
                  right.shape.points[(index + 1) % right.shape.points.length]!,
                ),
              );
            }
            for (const point of right.shape.points) {
              left.shape.points.forEach((start, index) =>
                consider(
                  point,
                  start,
                  left.shape.points[(index + 1) % left.shape.points.length]!,
                ),
              );
            }
            return candidates.sort((a, b) => a.gap - b.gap)[0] ?? null;
          };
          const connectorCrossesWall = (connector: {
            from: RoomPoint;
            to: RoomPoint;
          }) => {
            const midpoint = {
              x: (connector.from.x + connector.to.x) / 2,
              y: (connector.from.y + connector.to.y) / 2,
            };
            const wallTolerance = Math.max(
              GRID * 2,
              localGraph.wallThickness * 1.5,
            );
            return localStrongWalls.some(
              ([[x1, y1], [x2, y2]]) =>
                pointToSegmentDistance(
                  midpoint,
                  { x: x1, y: y1 },
                  { x: x2, y: y2 },
                ) <= wallTolerance,
            );
          };
          const nearest = candidateFaces
            .filter(
              (face) =>
                !selectedIds.has(face.id) &&
                selectedArea + face.area <= targetArea * 1.2,
            )
            .flatMap((face) => {
              const connectors = selectedFaces
                .map((selected) => closestConnector(face, selected))
                .filter(
                  (connector): connector is NonNullable<typeof connector> =>
                    Boolean(connector) && !connectorCrossesWall(connector!),
                )
                .sort((left, right) => left.gap - right.gap);
              const connector = connectors[0];
              return connector ? [{ face, shared: 0, gap: connector.gap }] : [];
            })
            .filter(
              ({ gap }) =>
                gap <=
                Math.max(MAX_LINK_GAP * 1.5, localGraph.wallThickness * 4),
            )
            .sort(
              (left, right) =>
                left.gap - right.gap || right.face.area - left.face.area,
            )[0];
          next = nearest;
        }
        if (!next) break;
        selectedIds.add(next.face.id);
        selectedArea += next.face.area;
      }
      const localFaces = candidateFaces.filter((face) =>
        selectedIds.has(face.id),
      );
      if (localFaces.length === 0) continue;
      const connectedSelected = unionRoomFaces(
        localFaces.map((face) => face.shape),
        localSeed,
        0,
      );
      const connectedSelectedArea = connectedSelected
        ? Math.abs(polygonArea(connectedSelected.points))
        : 0;
      log(
        `${item.seed.name}: aligned source union=${(connectedSelectedArea / Math.max(targetArea, Number.EPSILON)).toFixed(3)} target, ${connectedSelected?.points.length ?? 0} corners`,
      );
      const completeButComplex =
        connectedSelectedArea >= targetArea * 0.9 &&
        (connectedSelected?.points.length ?? 0) > 20;
      const rawWallCell =
        connectedSelectedArea < targetArea * 0.75 ||
        (connectedSelected?.points.length ?? 0) > 20
          ? wallSupportedUnitCell(
              localSeed,
              targetArea,
              localSeeds,
              localStrongWalls,
              localGraph.wallThickness,
              candidateFaces,
              completeButComplex
                ? {
                    maxAreaError: 0.6,
                    scoreAreaWeight: 0.25,
                    maxOwnershipError: 0.2,
                  }
                : {},
              (message) => log(`${item.seed.name}: ${message}`),
            )
          : null;
      const wallCell = rawWallCell
        ? subtractRoomShapes(
            rawWallCell,
            confirmedWallCells.map((cell) => cell.shape),
            localSeed,
          )
        : null;
      if (!wallCell) {
        pendingRasterRooms.push({ item, room, localFaces });
        continue;
      }
      const xs = wallCell.points.map((point) => point.x);
      const ys = wallCell.points.map((point) => point.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      confirmedWallCells.push({
        owner: item.index,
        bbox: {
          x,
          y,
          w: Math.max(...xs) - x,
          h: Math.max(...ys) - y,
        },
        shape: { ...wallCell, holes: [] },
      });
      replacements.set(item.index, {
        ...room,
        basis: "local-wall-cell",
        seed: { x: item.seed.x, y: item.seed.y },
        shape: {
          type: "polygon",
          points: wallCell.points.map((point) => unframePoint(frame, point)),
        },
      });
    }
    for (const { item, room, localFaces } of pendingRasterRooms) {
      const shape = localGridOutline(
        localFaces,
        Math.max(GRID * 2, localGraph.wallThickness * 1.5),
        [
          ...localGraph.faces.filter(
            (face) =>
              localOwner.has(face.id) && localOwner.get(face.id) !== item.index,
          ),
          ...confirmedWallCells
            .filter((cell) => cell.owner !== item.index)
            .map((cell) => ({ bbox: cell.bbox, shape: cell.shape })),
        ],
        localStrongWalls,
      );
      if (!shape) continue;
      replacements.set(item.index, {
        ...room,
        basis: "local-raster",
        seed: { x: item.seed.x, y: item.seed.y },
        shape: {
          type: "polygon",
          points: shape.points.map((point) => unframePoint(frame, point)),
        },
      });
    }
    log(
      `Local orientation frame traced ${cluster.length} unit labels at ${((angle * 180) / Math.PI).toFixed(1)}° from ${localGraph.faces.length} cropped wall faces`,
    );
  }
  return replacements;
}

export function detectFloorRooms(
  linework: FloorLinework,
  seeds: PdfRoomSeed[],
  log: Logger = () => undefined,
  existingGraph?: FloorGraph,
): DetectedFloorRooms {
  const graph = existingGraph ?? buildFloorGraph(linework, { log });
  const globalRooms = assignRooms(graph, seeds, log);
  const local = locallyAlignedUnitRooms(
    linework,
    seeds,
    graph,
    globalRooms,
    log,
  );
  const rooms = globalRooms.map((room) => {
    const index = seeds.findIndex(
      (seed) =>
        seed.name === room.name &&
        seed.kind === room.kind &&
        Math.hypot(seed.x - room.seed.x, seed.y - room.seed.y) < GRID,
    );
    return local.get(index) ?? room;
  });
  return { graph, rooms };
}

/**
 * Click-to-grow. The first point picks a space and grows it through doors
 * (never into spaces that already belong to saved rooms). Extra include
 * points add the space they sit in. Exclude points carve: within a space,
 * faces nearer (by hops across open boundaries) to an exclude point than to
 * an include point are dropped, so one "+" and one "−" split a space whose
 * dividing wall was drawn too lightly.
 */
export function growRoom(
  graph: FloorGraph,
  input: { include: RoomPoint[]; exclude: RoomPoint[]; taken?: number[] },
): { shape: RoomPolygonShape; faceIds: number[] } | null {
  const [origin, ...extras] = input.include;
  if (!origin) return null;
  const start = spaceAtPoint(graph, origin);
  if (!start) return null;

  const takenSpaces = new Set(
    (input.taken ?? []).map((faceId) => graph.faces[faceId]?.space ?? -1),
  );
  const excludeFaces = input.exclude.flatMap((point) =>
    facesAtPoint(graph, point).slice(0, 1),
  );
  const includeFaces = input.include.flatMap((point) =>
    facesAtPoint(graph, point).slice(0, 1),
  );
  const unavailable = new Set([
    ...takenSpaces,
    ...excludeFaces.map((face) => face.space),
  ]);

  const claimed = new Map<number, number>([[start.id, 0]]);
  growSpaces(
    graph,
    new Map([[0, { space: start.id, point: origin }]]),
    claimed,
    unavailable,
  );
  for (const face of includeFaces) {
    if (!takenSpaces.has(face.space)) claimed.set(face.space, 0);
  }

  const owner = new Map<number, number>();
  for (const spaceId of claimed.keys()) {
    for (const faceId of graph.spaces[spaceId]!.faceIds) owner.set(faceId, 0);
  }
  for (const face of excludeFaces) {
    for (const faceId of graph.spaces[face.space]!.faceIds)
      owner.delete(faceId);
  }
  for (const face of includeFaces) {
    if (!takenSpaces.has(face.space)) owner.set(face.id, 0);
  }

  // Carve contested spaces by hop distance across open boundaries.
  const contested = new Set(
    excludeFaces
      .map((face) => face.space)
      .filter((space) => includeFaces.some((face) => face.space === space)),
  );
  for (const spaceId of contested) {
    const space = graph.spaces[spaceId]!;
    const members = new Set(space.faceIds);
    const distanceFrom = (sources: number[]) => {
      const distance = new Map<number, number>();
      let frontier = sources.filter((id) => members.has(id));
      frontier.forEach((id) => distance.set(id, 0));
      while (frontier.length) {
        const next: number[] = [];
        for (const id of frontier) {
          for (const neighbor of graph.faces[id]!.neighbors) {
            if (
              !members.has(neighbor.face) ||
              distance.has(neighbor.face) ||
              neighbor.openLength < MIN_PASS_LENGTH
            ) {
              continue;
            }
            distance.set(neighbor.face, distance.get(id)! + 1);
            next.push(neighbor.face);
          }
        }
        frontier = next;
      }
      return distance;
    };
    const toInclude = distanceFrom(includeFaces.map((face) => face.id));
    const toExclude = distanceFrom(excludeFaces.map((face) => face.id));
    for (const faceId of space.faceIds) {
      const near = toInclude.get(faceId) ?? Number.POSITIVE_INFINITY;
      const far = toExclude.get(faceId) ?? Number.POSITIVE_INFINITY;
      if (far < near) owner.delete(faceId);
      else if (near < Number.POSITIVE_INFINITY) owner.set(faceId, 0);
    }
  }

  const blocked = new Set([
    ...(input.taken ?? []),
    ...excludeFaces.map((face) => face.id),
  ]);
  const roomAreas = new Map<number, number>([
    [0, [...owner.keys()].reduce((sum, id) => sum + graph.faces[id]!.area, 0)],
  ]);
  absorbOrphans(graph, owner, blocked, roomAreas);

  const faceIds = [...owner.keys()];
  if (faceIds.length === 0) return null;
  const shape = unionRoomFaces(
    faceIds.map((id) => graph.faces[id]!.shape),
    origin,
  );
  return shape ? { shape, faceIds } : null;
}
