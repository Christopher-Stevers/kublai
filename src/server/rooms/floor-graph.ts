import type { RoomPoint, RoomPolygonShape } from "~/lib/room-shape";
import { pointInPolygon } from "~/lib/room-shape";

import type { FloorLinework, PdfRoomSeed, WallSegment } from "./pdf-walls";
import {
  MIN_FACE_WIDTH,
  type PolygonFace,
  polygonizeLines,
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

/** Point test that respects holes (the building inside the site region). */
function faceContains(face: FloorFace, point: RoomPoint) {
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
      short > 0 && long / short >= CORRIDOR_ASPECT && long >= CORRIDOR_MIN_LENGTH,
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
  const midX = (right.a.x - left.a.x) * left.uy - (right.a.y - left.a.y) * left.ux;
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
  return Math.hypot(edge.a.x + edge.ux * t - point.x, edge.a.y + edge.uy * t - point.y);
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
        .some(
          (id) =>
            id !== a && id !== b && faceContains(faces[id]!, point),
        );
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
          if (span.gap >= MIN_FACE_WIDTH && faceBetween(span, face.id, otherId)) {
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
const VOID_PROBE_DEPTHS = [MIN_FACE_WIDTH, MIN_FACE_WIDTH * 2, MIN_FACE_WIDTH * 3];

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
  const at = (t: number) => ({ x: edge.a.x + edge.ux * t, y: edge.a.y + edge.uy * t });
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
      doors.set(other.space, (doors.get(other.space) ?? 0) + neighbor.doorLength);
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
  for (let round = 0; round < MAX_GROWTH_ROUNDS && frontier.length; round += 1) {
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
): AssignedRoom[] {
  const claimed = new Map<number, number>();
  const origins = new Map<number, { space: number; point: RoomPoint }>();
  const seedSpaces = new Set<number>();

  seeds.forEach((seed, index) => {
    const space =
      spaceAtPoint(graph, seed) ??
      (seed.anchors ?? []).map((point) => spaceAtPoint(graph, point)).find(Boolean) ??
      null;
    if (!space) {
      log(`${seed.name}: label is not inside any bounded region`);
      return;
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

  const { contested, rounds } = growSpaces(graph, origins, claimed, circulation);
  if (contested) {
    log(
      `${contested} space${contested === 1 ? "" : "s"} reached by several units at once left as shared/circulation`,
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

  const rooms = finishRooms(graph, seeds, owner, log);
  for (const room of rooms) {
    const spaces = new Set(room.faceIds.map((id) => graph.faces[id]!.space));
    log(
      `${room.name}: ${spaces.size} space${spaces.size === 1 ? "" : "s"}, ${room.shape.points.length} corners`,
    );
  }
  return rooms;
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
  growSpaces(graph, new Map([[0, { space: start.id, point: origin }]]), claimed, unavailable);
  for (const face of includeFaces) {
    if (!takenSpaces.has(face.space)) claimed.set(face.space, 0);
  }

  const owner = new Map<number, number>();
  for (const spaceId of claimed.keys()) {
    for (const faceId of graph.spaces[spaceId]!.faceIds) owner.set(faceId, 0);
  }
  for (const face of excludeFaces) {
    for (const faceId of graph.spaces[face.space]!.faceIds) owner.delete(faceId);
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
