import {
  toPolygon,
  type RoomPolygonShape,
  type RoomShape,
} from "~/lib/room-shape";
import { roomArea, roomOverlap } from "./supplementary-rooms";
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory.js";
import type Geometry from "jsts/org/locationtech/jts/geom/Geometry.js";
import IsValidOp from "jsts/org/locationtech/jts/operation/valid/IsValidOp.js";

const geometryReader = new GeoJSONReader(new GeometryFactory());
// Shape objects can be reused across many pairwise comparisons. Fingerprints
// prevent a later editor mutation from inheriting an earlier valid result.
const validityCache = new WeakMap<
  object,
  { fingerprint: string; valid: boolean }
>();

/** Review history is durable JSON; malformed legacy geometry must not invent a room. */
export function validReviewShape(value: unknown): value is RoomShape {
  if (!value || typeof value !== "object") return false;
  const shape = value as Record<string, unknown>;
  const coordinate = (value: unknown) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1;
  const isBox =
    shape.type === "bbox" &&
    [shape.x, shape.y, shape.w, shape.h].every(coordinate) &&
    (shape.w as number) > 0 &&
    (shape.h as number) > 0 &&
    (shape.x as number) + (shape.w as number) <= 1 &&
    (shape.y as number) + (shape.h as number) <= 1;
  const ring = (value: unknown) =>
    Array.isArray(value) &&
    value.length >= 3 &&
    value.every((point: unknown) => {
      if (!point || typeof point !== "object") return false;
      const p = point as Record<string, unknown>;
      return coordinate(p.x) && coordinate(p.y);
    });
  if (
    !isBox &&
    !(
      shape.type === "polygon" &&
      ring(shape.points) &&
      (shape.holes === undefined ||
        (Array.isArray(shape.holes) && shape.holes.every(ring)))
    )
  )
    return false;
  const polygon = toPolygon(value as RoomShape);
  const fingerprint = JSON.stringify(polygon);
  const cached = validityCache.get(value);
  if (cached?.fingerprint === fingerprint) return cached.valid;
  let valid = false;
  try {
    const geometry = geometryReader.read({
      type: "Polygon",
      coordinates: [polygon.points, ...(polygon.holes ?? [])].map((ring) => {
        const points = ring.map((point) => [point.x, point.y]);
        return [...points, points[0]];
      }),
    }) as Geometry;
    const area = geometry.getArea();
    valid =
      Number.isFinite(area) && area > 0 && new IsValidOp(geometry).isValid();
  } catch {
    // Invalid legacy rings remain history, but are not suppression or training truth.
  }
  validityCache.set(value, { fingerprint, valid });
  return valid;
}
export function roomIoU(a: RoomPolygonShape, b: RoomPolygonShape) {
  if (!validReviewShape(a) || !validReviewShape(b)) return 0;
  const intersection = roomOverlap(a, b);
  const union = roomArea(a) + roomArea(b) - intersection;
  return Number.isFinite(intersection) && union > 0 ? intersection / union : 0;
}
export function latestReviewDecisions<
  T extends {
    roomId: string;
    decision: string;
    drawingKey: string;
    proposalShape: unknown;
  },
>(events: T[], drawingKey: string) {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (event.drawingKey !== drawingKey || seen.has(event.roomId)) return false;
    seen.add(event.roomId);
    return true;
  });
}
export function rejectedByReview(
  shape: RoomPolygonShape,
  events: Array<{
    decision: string;
    proposalShape: unknown;
    detection?: unknown;
  }>,
  drawingHash?: string,
) {
  return events.some((event) => {
    const metadata = event.detection as {
      drawingHash?: unknown;
      reviewReason?: unknown;
    } | null;
    const hash = metadata?.drawingHash;
    return (
      event.decision === "rejected" &&
      validReviewShape(event.proposalShape) &&
      (!drawingHash || hash === drawingHash) &&
      roomIoU(shape, toPolygon(event.proposalShape)) >=
        (metadata?.reviewReason === "not-space" ? 0.65 : 0.98)
    );
  });
}
