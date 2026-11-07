import { toPolygon } from "~/lib/room-shape";
import { labelOutlines } from "../hybrid/mask-outline";

/** Polygon outlines for a label image (1..seeds.length = named, higher = unnamed). */
export function outlineRooms(
  labels: Int32Array,
  width: number,
  height: number,
  seeds: Array<{ name: string }>,
  version: string,
  renames: Map<number, string> = new Map(),
) {
  const door = 0.0095 * Math.max(width, height);
  const outlines = labelOutlines(labels, width, {
    epsilon: Math.max(1, door / 12),
    minAreaPx: Math.max(25, Math.round(door * door * 0.4)),
    includeHoles: true,
  });
  let unnamed = 0;
  return outlines.map((outline) => {
    const seed = outline.label <= seeds.length ? seeds[outline.label - 1] : undefined;
    const normalize = (points: Array<{ x: number; y: number }>) =>
      points.map((p) => ({ x: p.x / width, y: p.y / height }));
    return {
      name: renames.get(outline.label) ?? seed?.name ?? `Unlabeled space ${++unnamed}`,
      shape: toPolygon({
        type: "polygon",
        points: normalize(outline.points),
        ...(outline.holes?.length ? { holes: outline.holes.map(normalize) } : {}),
      }),
      detection: {
        version,
        basis: seed ? "label-and-walls" : "walls-without-label",
        areaFraction: outline.areaPx / (width * height),
        requiresReview: true,
      },
    };
  });
}
