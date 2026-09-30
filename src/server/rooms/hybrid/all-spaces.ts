import { toPolygon } from "~/lib/room-shape";
import {
  detectHybridRooms,
  HYBRID_CONFIG,
  type HybridSeed,
} from "./detect-hybrid";
import { inkWallAngle, rotateWallImage } from "./deskew";
import { labelOutlines } from "./mask-outline";

export const ALL_SPACES_VERSION = "all-spaces-v1";
export const ALL_SPACES_CONFIG = {
  ...HYBRID_CONFIG,
  discoverSpaces: true,
  grow: false,
  gapFactor: 0.3,
  // An area threshold alone must not discard a large interior hall.
  // Only border-connected background is excluded; enclosed outdoor/legend
  // candidates remain explicitly unapproved until reviewed.
  outdoorFraction: 1,
};

/** Geometry proposes spaces even when the PDF has no room text layer. */
export function detectAllSpaces(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  seeds: Array<HybridSeed & { name: string }>,
  deskew = true,
  gapFactor?: number,
): {
  rooms: Array<{
    name: string;
    shape: ReturnType<typeof toPolygon>;
    detection: {
      version: string;
      basis: string;
      areaFraction: number;
      requiresReview: boolean;
    };
  }>;
  labels: Int32Array;
  rejectedSeeds: Array<{ seedIndex: number; reason: string }>;
  partitionedComponents: number;
  unlabeledCount: number;
} {
  const angle = deskew ? inkWallAngle(rgba, width, height) : 0;
  if (Math.abs(angle) > Math.PI / 180) {
    const rotated = rotateWallImage(rgba, width, height, angle);
    const result = detectAllSpaces(
      rotated.rgba,
      rotated.width,
      rotated.height,
      seeds.map((seed) => ({ ...seed, ...rotated.forward(seed) })),
      false,
      gapFactor,
    );
    const labels = new Int32Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const p = rotated.forward({
          x: (x + 0.5) / width,
          y: (y + 0.5) / height,
        });
        const rx = Math.floor(p.x * rotated.width),
          ry = Math.floor(p.y * rotated.height);
        if (rx >= 0 && ry >= 0 && rx < rotated.width && ry < rotated.height)
          labels[y * width + x] = result.labels[ry * rotated.width + rx]!;
      }
    return {
      ...result,
      labels,
      rooms: result.rooms.map((room) => ({
        ...room,
        shape: toPolygon({
          type: "polygon",
          points: room.shape.points.map(rotated.inverse),
          ...(room.shape.holes?.length
            ? {
                holes: room.shape.holes.map((ring) =>
                  ring.map(rotated.inverse),
                ),
              }
            : {}),
        }),
      })),
    };
  }
  const result = detectHybridRooms(rgba, width, height, seeds, {
    ...ALL_SPACES_CONFIG,
    gapFactor: gapFactor ?? ALL_SPACES_CONFIG.gapFactor,
  });
  // Start with short repairs to avoid inventing divisions in closed plans.
  // If the drawing's own labels leak outside, retry with door-width repairs.
  // No reference polygons or human acceptance labels influence this decision.
  if (
    gapFactor === undefined &&
    seeds.length > 0 &&
    result.rejectedSeeds.length > seeds.length * 0.15
  ) {
    const repaired = detectAllSpaces(
      rgba,
      width,
      height,
      seeds,
      false,
      HYBRID_CONFIG.gapFactor,
    );
    if (repaired.rejectedSeeds.length < result.rejectedSeeds.length)
      return repaired;
  }
  const door = 0.0095 * Math.max(width, height);
  const outlines = labelOutlines(result.labels, width, {
    epsilon: Math.max(1, door / 12),
    minAreaPx: Math.max(25, Math.round(door * door * 0.4)),
    includeHoles: true,
  });
  const rooms = outlines.map((outline) => {
    const label = seeds[outline.label - 1];
    const normalize = (points: Array<{ x: number; y: number }>) =>
      points.map((p) => ({ x: p.x / width, y: p.y / height }));
    return {
      name: label?.name ?? `Unlabeled space ${outline.label - seeds.length}`,
      shape: toPolygon({
        type: "polygon",
        points: normalize(outline.points),
        ...(outline.holes?.length
          ? { holes: outline.holes.map(normalize) }
          : {}),
      }),
      detection: {
        version: ALL_SPACES_VERSION,
        basis: label ? "label-and-walls" : "walls-without-label",
        areaFraction: outline.areaPx / (width * height),
        requiresReview: true,
      },
    };
  });
  return {
    rooms,
    labels: result.labels,
    rejectedSeeds: result.rejectedSeeds,
    partitionedComponents: result.partitionedComponents,
    unlabeledCount: rooms.filter(
      (room) => room.detection.basis === "walls-without-label",
    ).length,
  };
}
