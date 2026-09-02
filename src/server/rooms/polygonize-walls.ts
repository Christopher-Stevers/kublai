import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import GeoJSONWriter from "jsts/org/locationtech/jts/io/GeoJSONWriter.js";
import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory.js";
import BufferOp from "jsts/org/locationtech/jts/operation/buffer/BufferOp.js";
import BufferParameters from "jsts/org/locationtech/jts/operation/buffer/BufferParameters.js";
import Polygonizer from "jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js";
import UnaryUnionOp from "jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js";

import type { RoomPoint, RoomPolygonShape } from "~/lib/room-shape";
import { pointInPolygon } from "~/lib/room-shape";
import type { WallSegment } from "./pdf-walls";

const GRID = 0.0005;
const MAX_DOOR_GAP = 0.024;
const MIN_FACE_AREA = 0.000025;
const MAX_FACE_AREA = 0.18;
const MIN_FACE_WIDTH = 0.002;
const MAX_FACE_VERTICES = 120;
const WALL_CLOSE_DISTANCE = 0.0025;

type Axis = "h" | "v";
type Interval = { start: number; end: number };
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

function quantize(value: number) {
  return Math.round(value / GRID) * GRID;
}

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

function normalizePolygon(points: RoomPoint[]): RoomPolygonShape | null {
  const unique = points.filter((point, index) => {
    const previous = points[(index + points.length - 1) % points.length]!;
    return Math.hypot(point.x - previous.x, point.y - previous.y) >= GRID / 2;
  });
  const simplified = simplify(unique);
  if (simplified.length < 3 || simplified.length > MAX_FACE_VERTICES)
    return null;
  const area = Math.abs(polygonArea(simplified));
  if (area < MIN_FACE_AREA || area > MAX_FACE_AREA) return null;
  const box = bbox(simplified);
  if (Math.min(box.w, box.h) < MIN_FACE_WIDTH) return null;
  const oriented =
    polygonArea(simplified) < 0 ? [...simplified].reverse() : simplified;
  return { type: "polygon", points: oriented };
}

function toAxisWall(wall: WallSegment) {
  const dx = Math.abs(wall.x2 - wall.x1);
  const dy = Math.abs(wall.y2 - wall.y1);
  const axis: Axis | null = dy < dx * 0.18 ? "h" : dx < dy * 0.18 ? "v" : null;
  if (!axis) return null;
  const fixed = quantize(
    axis === "h" ? (wall.y1 + wall.y2) / 2 : (wall.x1 + wall.x2) / 2,
  );
  const start = quantize(
    Math.min(
      axis === "h" ? wall.x1 : wall.y1,
      axis === "h" ? wall.x2 : wall.y2,
    ),
  );
  const end = quantize(
    Math.max(
      axis === "h" ? wall.x1 : wall.y1,
      axis === "h" ? wall.x2 : wall.y2,
    ),
  );
  if (end - start < GRID * 2) return null;
  return { axis, fixed, start, end };
}

function collapseLinework(walls: WallSegment[]) {
  const groups = new Map<string, Interval[]>();
  for (const wall of walls) {
    const axisWall = toAxisWall(wall);
    if (!axisWall) continue;
    const key = `${axisWall.axis}:${axisWall.fixed.toFixed(4)}`;
    const intervals = groups.get(key) ?? [];
    intervals.push({ start: axisWall.start, end: axisWall.end });
    groups.set(key, intervals);
  }

  const lines: number[][][] = [];
  for (const [key, intervals] of groups) {
    intervals.sort((left, right) => left.start - right.start);
    const [axis, fixedText] = key.split(":") as [Axis, string];
    const fixed = Number(fixedText);
    let current = { ...intervals[0]! };
    const emit = () => {
      lines.push(
        axis === "h"
          ? [
              [current.start, fixed],
              [current.end, fixed],
            ]
          : [
              [fixed, current.start],
              [fixed, current.end],
            ],
      );
    };
    for (let i = 1; i < intervals.length; i += 1) {
      const next = intervals[i]!;
      if (next.start <= current.end + MAX_DOOR_GAP) {
        current.end = Math.max(current.end, next.end);
      } else {
        emit();
        current = { ...next };
      }
    }
    emit();
  }
  return lines;
}

function readPolygons(geometry: unknown): RoomPolygonShape[] {
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
    const ring = polygon.coordinates[0] ?? [];
    const points = ring.slice(0, -1).map(([x = 0, y = 0]) => ({ x, y }));
    const normalized = normalizePolygon(points);
    return normalized ? [normalized] : [];
  });
}

function polygonizeLines(lines: number[][][]) {
  if (lines.length < 4) return [];
  const reader = new GeoJSONReader(new GeometryFactory());
  const writer = new GeoJSONWriter();
  const linework = reader.read({ type: "MultiLineString", coordinates: lines });
  const noded = UnaryUnionOp.union(linework);
  const polygonizer = new Polygonizer();
  polygonizer.add(noded);
  return readPolygons(writer.write(polygonizer.getGeometry()));
}

export function polygonizeWalls(walls: WallSegment[]): RoomPolygonShape[] {
  if (walls.length < 16) return [];
  try {
    const lines = collapseLinework(walls);
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

export function unionRoomFaces(
  faces: RoomPolygonShape[],
  seed?: RoomPoint,
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
    const parameters = new BufferParameters(
      1,
      BufferParameters.CAP_SQUARE,
      BufferParameters.JOIN_MITRE,
      4,
    );
    const closed = BufferOp.bufferOp(
      BufferOp.bufferOp(unioned, WALL_CLOSE_DISTANCE, parameters),
      -WALL_CLOSE_DISTANCE,
      parameters,
    );
    const polygons = readPolygons(writer.write(closed));
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
