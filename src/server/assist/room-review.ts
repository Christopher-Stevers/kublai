import { z } from "zod";
const point = z.object({ x: z.number().finite(), y: z.number().finite() });
const shapeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("polygon"),
    points: z.array(point).min(3).max(20_000),
  }),
  z.object({
    type: z.literal("bbox"),
    x: z.number().finite(),
    y: z.number().finite(),
    w: z.number().finite().positive(),
    h: z.number().finite().positive(),
  }),
]);
export function summarizeRoomShape(raw: unknown) {
  const parsed = shapeSchema.safeParse(raw);
  if (!parsed.success)
    return { geometry: null, warning: "Room geometry is missing or invalid." };
  const shape = parsed.data;
  const points =
    shape.type === "polygon"
      ? shape.points
      : [
          { x: shape.x, y: shape.y },
          { x: shape.x + shape.w, y: shape.y },
          { x: shape.x + shape.w, y: shape.y + shape.h },
          { x: shape.x, y: shape.y + shape.h },
        ];
  let signedArea = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    signedArea += a.x * b.y - b.x * a.y;
  }
  const area = Math.abs(signedArea / 2);
  const outside = points.some((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1);
  const warning = outside
    ? "Outline extends outside the drawing."
    : area < 0.000001
      ? "Outline has zero or near-zero area."
      : null;
  return {
    geometry: {
      pointCount: points.length,
      normalizedArea: area,
      bounds: {
        left: Math.min(...points.map((p) => p.x)),
        right: Math.max(...points.map((p) => p.x)),
        top: Math.min(...points.map((p) => p.y)),
        bottom: Math.max(...points.map((p) => p.y)),
      },
      // Bound provider input; retain exact geometry locally. Do not simplify saved polygons.
      points: points.length <= 100 ? points : undefined,
      boundaryOmitted: points.length > 100,
    },
    warning,
  };
}
