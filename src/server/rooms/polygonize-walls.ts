import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import GeoJSONWriter from "jsts/org/locationtech/jts/io/GeoJSONWriter.js";
import Coordinate from "jsts/org/locationtech/jts/geom/Coordinate.js";
import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory.js";
import PrecisionModel from "jsts/org/locationtech/jts/geom/PrecisionModel.js";
import GeometryNoder from "jsts/org/locationtech/jts/noding/snapround/GeometryNoder.js";
import BufferOp from "jsts/org/locationtech/jts/operation/buffer/BufferOp.js";
import BufferParameters from "jsts/org/locationtech/jts/operation/buffer/BufferParameters.js";
import OverlayOp from "jsts/org/locationtech/jts/operation/overlay/OverlayOp.js";
import Polygonizer from "jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js";
import UnaryUnionOp from "jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js";
import ArrayList from "jsts/java/util/ArrayList.js";

import type { RoomPoint, RoomPolygonShape } from "~/lib/room-shape";
import { pointInPolygon } from "~/lib/room-shape";
import type { WallSegment } from "./pdf-walls";
import { GRID, buildWallLinework, quantize } from "./wall-lines";

const MIN_FACE_AREA = 0.000025;
const MAX_FACE_AREA = 0.18;
export const MIN_FACE_WIDTH = 0.002;
const MAX_FACE_VERTICES = 120;
/** Hard cap on ring size even when oversized regions are kept. */
const MAX_RING_VERTICES = 4000;
/** Second noding pass uses a hot pixel this many times smaller than GRID. */
const RENODE_SCALE = 8;
const MAX_REPAIRED_COVERAGE = 0.5;

/**
 * A polygonizer face with its inner rings. The region around a building is
 * one face with the building as a hole; the graph needs the hole rings so the
 * region can neighbour the exterior walls and so point tests exclude the hole.
 */
export type PolygonFace = RoomPolygonShape & { holes: RoomPoint[][] };

type ReadOptions = {
  /** Keep oversized/complex regions (site, sheet margin) instead of dropping them. */
  keepLarge?: boolean;
  /** Preserve smaller atomic cells for bounded source-wall arrangements. */
  minArea?: number;
};

type GeoJsonPolygon = {
  type: "Polygon";
  coordinates: number[][][];
};
type GeoJsonGeometryCollection = {
  type: "GeometryCollection";
  geometries: Array<GeoJsonPolygon | { type: string }>;
};
type GeoJsonMultiPolygon = {
  type: "MultiPolygon";
  coordinates: number[][][][];
};

function polygonArea(points: RoomPoint[]) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function bbox(points: RoomPoint[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    w: Math.max(...xs) - x,
    h: Math.max(...ys) - y,
  };
}

function simplify(points: RoomPoint[]) {
  if (points.length < 4) return points;
  const out: RoomPoint[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const previous = points[(i + points.length - 1) % points.length]!;
    const current = points[i]!;
    const next = points[(i + 1) % points.length]!;
    const ax = current.x - previous.x;
    const ay = current.y - previous.y;
    const bx = next.x - current.x;
    const by = next.y - current.y;
    const cross = Math.abs(ax * by - ay * bx);
    const scale = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (scale > 0 && cross / scale < 0.015) continue;
    out.push(current);
  }
  return out.length >= 3 ? out : points;
}

function normalizeRing(
  points: RoomPoint[],
  options: ReadOptions,
): RoomPoint[] | null {
  const unique = points.filter((point, index) => {
    const previous = points[(index + points.length - 1) % points.length]!;
    return Math.hypot(point.x - previous.x, point.y - previous.y) >= GRID / 2;
  });
  const simplified = simplify(unique);
  const maxVertices = options.keepLarge ? MAX_RING_VERTICES : MAX_FACE_VERTICES;
  if (simplified.length < 3 || simplified.length > maxVertices) return null;
  const area = Math.abs(polygonArea(simplified));
  if (area < (options.minArea ?? MIN_FACE_AREA)) return null;
  if (!options.keepLarge && area > MAX_FACE_AREA) return null;
  const box = bbox(simplified);
  if (Math.min(box.w, box.h) < MIN_FACE_WIDTH) return null;
  return polygonArea(simplified) < 0 ? [...simplified].reverse() : simplified;
}

function normalizePolygon(
  rings: number[][][],
  options: ReadOptions,
): PolygonFace | null {
  const [shell = [], ...inner] = rings;
  const points = normalizeRing(
    shell.slice(0, -1).map(([x = 0, y = 0]) => ({ x, y })),
    options,
  );
  if (!points) return null;
  const holes = options.keepLarge
    ? inner.flatMap((ring) => {
        const hole = normalizeRing(
          ring.slice(0, -1).map(([x = 0, y = 0]) => ({ x, y })),
          options,
        );
        return hole ? [hole] : [];
      })
    : [];
  return { type: "polygon", points, holes };
}

function readPolygons(
  geometry: unknown,
  options: ReadOptions = {},
): PolygonFace[] {
  const geo = geometry as
    | GeoJsonPolygon
    | GeoJsonMultiPolygon
    | GeoJsonGeometryCollection;
  let polygons: GeoJsonPolygon[] = [];
  if (geo.type === "Polygon") {
    polygons = [geo];
  } else if (geo.type === "MultiPolygon") {
    polygons = geo.coordinates.map((coordinates) => ({
      type: "Polygon",
      coordinates,
    }));
  } else if (geo.type === "GeometryCollection") {
    polygons = geo.geometries.filter(
      (item): item is GeoJsonPolygon => item.type === "Polygon",
    );
  }

  return polygons.flatMap((polygon) => {
    const normalized = normalizePolygon(polygon.coordinates, options);
    return normalized ? [normalized] : [];
  });
}

/**
 * Snap every noded vertex to GRID and drop the resulting zero-length and
 * duplicate segments. Diagonal linework (door-swing chords, angled walls)
 * has off-grid endpoints; the snap-rounder bends straight walls onto those
 * points, and two source lines can then emit the identical tiny segment.
 * Duplicate edges confuse the polygonizer's left/right ring labelling, so a
 * party wall gets deleted as a "cut edge" and two suites merge into one face.
 */
function snapAndDedupe(noded: ArrayList, factory: GeometryFactory) {
  const seen = new Set<string>();
  const clean = new ArrayList(undefined);
  for (let i = 0; i < noded.size(); i += 1) {
    const coords = noded.get(i).getCoordinates();
    for (let j = 1; j < coords.length; j += 1) {
      const a = new Coordinate(
        quantize(coords[j - 1].x),
        quantize(coords[j - 1].y),
      );
      const b = new Coordinate(quantize(coords[j].x), quantize(coords[j].y));
      if (a.equals2D(b)) continue;
      const key =
        a.x < b.x || (a.x === b.x && a.y < b.y)
          ? `${a.x},${a.y}|${b.x},${b.y}`
          : `${b.x},${b.y}|${a.x},${a.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      clean.add(factory.createLineString([a, b]));
    }
  }
  return clean;
}

export function polygonizeLines(
  lines: number[][][],
  options: ReadOptions = {},
): PolygonFace[] {
  if (lines.length < 4) return [];
  const factory = new GeometryFactory();
  const reader = new GeoJSONReader(factory);
  const writer = new GeoJSONWriter();
  const linework = reader.read({ type: "MultiLineString", coordinates: lines });
  const geometries = new ArrayList(undefined);
  geometries.add(linework);
  const noder = new GeometryNoder(new PrecisionModel(1 / GRID));
  // Snapping can create new crossings, so node a second time. After the
  // snap every vertex sits on a GRID corner, so a second GRID-sized hot pixel
  // reaches the neighbouring rows: parallel lines one GRID apart (a door leaf
  // or a wall drawn as several near-duplicate strokes) get zig-zagged into
  // each other. A finer pixel only nodes the genuine new crossings.
  const renoder = new GeometryNoder(new PrecisionModel(RENODE_SCALE / GRID));
  const noded = renoder.node(snapAndDedupe(noder.node(geometries), factory));
  const polygonizer = new Polygonizer();
  polygonizer.add(noded);
  const faces = readPolygons(writer.write(polygonizer.getGeometry()), options);
  return faces.concat(repairInvalidRings(polygonizer, writer, faces, options));
}

function centroid(points: RoomPoint[]): RoomPoint {
  const sum = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/**
 * A room with an interior wall spur (closet return, stair stringer) forms a
 * self-touching ring, which JSTS silently discards as invalid and the room
 * disappears. A zero-width buffer splits such a ring into valid polygons.
 * Invalid rings also include outer boundaries that wrap whole wings, so a
 * repaired ring only counts when it is not already covered by valid faces.
 */
function repairInvalidRings(
  polygonizer: Polygonizer,
  writer: GeoJSONWriter,
  faces: PolygonFace[],
  options: ReadOptions,
) {
  const factory = new GeometryFactory();
  const invalid = polygonizer.getInvalidRingLines();
  const known = faces.map((face) => ({
    point: centroid(face.points),
    area: Math.abs(polygonArea(face.points)),
  }));
  const repaired: PolygonFace[] = [];
  for (let i = 0; i < invalid.size(); i += 1) {
    const line = invalid.get(i);
    if (line.getNumPoints() < 4) continue;
    let candidates: PolygonFace[] = [];
    try {
      const shell = factory.createPolygon(
        factory.createLinearRing(line.getCoordinates()),
      );
      candidates = readPolygons(
        writer.write(BufferOp.bufferOp(shell, 0)),
        options,
      );
    } catch {
      continue;
    }
    for (const candidate of candidates) {
      const area = Math.abs(polygonArea(candidate.points));
      const covered = known
        .filter((face) => pointInPolygon(face.point, candidate))
        .reduce((sum, face) => sum + face.area, 0);
      // Stair treads and columns sit inside a real room as small islands; a
      // wing outline is nearly all existing faces.
      if (covered <= area * MAX_REPAIRED_COVERAGE) repaired.push(candidate);
    }
  }
  return repaired;
}

export function polygonizeWalls(walls: WallSegment[]): RoomPolygonShape[] {
  if (walls.length < 16) return [];
  try {
    const lines = buildWallLinework(walls, { mode: "all" }).lines;
    const rooms = polygonizeLines(lines);
    console.log(
      "[polygonize] walls",
      walls.length,
      "collapsed",
      lines.length,
      "faces",
      rooms.length,
    );
    return rooms;
  } catch (error) {
    console.warn(
      "[polygonize] topology failed",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

function polygonToGeoJson(polygon: RoomPolygonShape): GeoJsonPolygon {
  const ring = polygon.points.map((point) => [point.x, point.y]);
  ring.push([...ring[0]!] as number[]);
  return { type: "Polygon", coordinates: [ring] };
}

/**
 * Remove already-confirmed source-wall cells from a later candidate. The
 * retained component must contain the room seed; disconnected scraps are not
 * promoted to rooms. Boolean subtraction preserves the shared source-wall
 * boundary exactly and is used only after both candidate perimeters passed
 * the wall evidence checks.
 */
export function subtractRoomShapes(
  shape: RoomPolygonShape,
  blockers: RoomPolygonShape[],
  seed: RoomPoint,
): RoomPolygonShape | null {
  if (blockers.length === 0) return shape;
  try {
    const reader = new GeoJSONReader(new GeometryFactory());
    const writer = new GeoJSONWriter();
    let geometry = reader.read(polygonToGeoJson(shape));
    for (const blocker of blockers) {
      geometry = OverlayOp.difference(
        geometry,
        reader.read(polygonToGeoJson(blocker)),
      );
      if (geometry.isEmpty()) return null;
    }
    return (
      readPolygons(writer.write(geometry))
        .map(({ points }): RoomPolygonShape => ({ type: "polygon", points }))
        .find((candidate) => pointInPolygon(seed, candidate)) ?? null
    );
  } catch {
    return null;
  }
}

export function unionRoomFaces(
  faces: RoomPolygonShape[],
  seed?: RoomPoint,
  closeDistance = 0,
): RoomPolygonShape | null {
  if (faces.length === 0) return null;
  try {
    const reader = new GeoJSONReader(new GeometryFactory());
    const writer = new GeoJSONWriter();
    const geometry = reader.read({
      type: "GeometryCollection",
      geometries: faces.map(polygonToGeoJson),
    });
    const unioned = UnaryUnionOp.union(geometry);
    // A room outline must be an actual connected union of owned faces.
    // Morphological closing here used to bridge nearby but disconnected
    // components. On rotated wings that manufactured large mitred wedges
    // across diagonal walls and made unrelated corridor/stair fragments look
    // like part of the suite. Face recovery belongs in the graph; output
    // geometry must stay on the recovered face boundaries.
    const output =
      closeDistance > 0
        ? (() => {
            const closeParameters = new BufferParameters(
              1,
              BufferParameters.CAP_FLAT,
              BufferParameters.JOIN_MITRE,
              4,
            );
            return BufferOp.bufferOp(
              BufferOp.bufferOp(unioned, closeDistance, closeParameters),
              -closeDistance,
              closeParameters,
            );
          })()
        : unioned;
    const polygons = readPolygons(writer.write(output)).map(
      ({ points }): RoomPolygonShape => ({ type: "polygon", points }),
    );
    if (seed) {
      const containing = polygons.find((polygon) =>
        pointInPolygon(seed, polygon),
      );
      if (containing) return containing;
    }
    return (
      polygons.sort(
        (left, right) =>
          Math.abs(polygonArea(right.points)) -
          Math.abs(polygonArea(left.points)),
      )[0] ?? null
    );
  } catch (error) {
    console.warn(
      "[polygonize] union failed",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export function facesContainingPoint(
  faces: RoomPolygonShape[],
  point: RoomPoint,
) {
  return faces.filter((face) => pointInPolygon(point, face));
}
