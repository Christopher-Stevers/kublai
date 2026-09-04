import sharp from "sharp";

import type { RoomPoint, RoomPolygonShape } from "~/lib/room-shape";

export type ImagineRoomRegion = {
  id: number;
  pixelCount: number;
  color: { r: number; g: number; b: number };
  centroid: RoomPoint;
  shape: RoomPolygonShape;
};

export type ImagineRoomAssignment = {
  id: number;
  name: string;
  include: boolean;
  confidence: number;
};

type PixelImage = {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
};

type Component = {
  label: number;
  pixelCount: number;
  sumX: number;
  sumY: number;
  sumR: number;
  sumG: number;
  sumB: number;
};

type GridPoint = { x: number; y: number };

const HUE_BUCKETS = 18;
const MIN_COMPONENT_RATIO = 0.00008;
const MAX_COMPONENT_RATIO = 0.4;

function circularDistance(a: number, b: number, period: number) {
  const distance = Math.abs(a - b);
  return Math.min(distance, period - distance);
}

function hueBucket(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma === 0) return { bucket: -1, saturation: 0, value: max / 255 };

  let hue: number;
  if (max === r) hue = ((g - b) / chroma) % 6;
  else if (max === g) hue = (b - r) / chroma + 2;
  else hue = (r - g) / chroma + 4;
  hue = ((hue * 60 + 360) % 360) / 360;
  return {
    bucket: Math.floor(hue * HUE_BUCKETS) % HUE_BUCKETS,
    saturation: chroma / max,
    value: max / 255,
  };
}

function pixelOffset(image: PixelImage, index: number) {
  return index * image.channels;
}

function classifyColoredPixel(
  source: PixelImage,
  colored: PixelImage,
  index: number,
) {
  const sourceOffset = pixelOffset(source, index);
  const coloredOffset = pixelOffset(colored, index);
  const sr = source.data[sourceOffset] ?? 255;
  const sg = source.data[sourceOffset + 1] ?? 255;
  const sb = source.data[sourceOffset + 2] ?? 255;
  const r = colored.data[coloredOffset] ?? 255;
  const g = colored.data[coloredOffset + 1] ?? 255;
  const b = colored.data[coloredOffset + 2] ?? 255;
  const output = hueBucket(r, g, b);
  const input = hueBucket(sr, sg, sb);
  const delta = Math.hypot(r - sr, g - sg, b - sb);

  if (output.saturation < 0.18 || output.value < 0.14) return 0;
  if (delta < 24) return 0;
  if (delta < 48 && output.saturation - input.saturation < 0.1) return 0;
  return output.bucket + 1;
}

async function rawRgb(image: Buffer, width?: number, height?: number) {
  let pipeline = sharp(image).removeAlpha();
  if (width && height) {
    pipeline = pipeline.resize(width, height, { fit: "fill" });
  }
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  } satisfies PixelImage;
}

function direction(edge: [number, number, number, number]) {
  const dx = edge[2] - edge[0];
  const dy = edge[3] - edge[1];
  if (dx > 0) return 0;
  if (dy > 0) return 1;
  if (dx < 0) return 2;
  return 3;
}

function edgeKey(x1: number, y1: number, x2: number, y2: number) {
  return `${x1},${y1}:${x2},${y2}`;
}

function pointKey(x: number, y: number) {
  return `${x},${y}`;
}

function signedArea(points: GridPoint[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function perpendicularDistance(point: GridPoint, a: GridPoint, b: GridPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  return (
    Math.abs(dy * point.x - dx * point.y + b.x * a.y - b.y * a.x) /
    Math.hypot(dx, dy)
  );
}

function simplifyOpen(points: GridPoint[], tolerance: number): GridPoint[] {
  if (points.length <= 2) return points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let farthest = -1;
  let maxDistance = tolerance;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularDistance(points[index]!, first, last);
    if (distance > maxDistance) {
      farthest = index;
      maxDistance = distance;
    }
  }
  if (farthest < 0) return [first, last];
  return [
    ...simplifyOpen(points.slice(0, farthest + 1), tolerance).slice(0, -1),
    ...simplifyOpen(points.slice(farthest), tolerance),
  ];
}

function simplifyClosed(points: GridPoint[], tolerance: number) {
  if (points.length <= 4) return points;
  let split = 1;
  let farthest = 0;
  const first = points[0]!;
  for (let index = 1; index < points.length; index += 1) {
    const distance = Math.hypot(points[index]!.x - first.x, points[index]!.y - first.y);
    if (distance > farthest) {
      farthest = distance;
      split = index;
    }
  }
  const left = simplifyOpen(points.slice(0, split + 1), tolerance);
  const right = simplifyOpen(
    [...points.slice(split), first],
    tolerance,
  );
  return [...left.slice(0, -1), ...right.slice(0, -1)];
}

function componentPolygon(
  labels: Int32Array,
  componentLabel: number,
  width: number,
  height: number,
) {
  const outgoing = new Map<string, Array<[number, number, number, number]>>();
  const edges: Array<[number, number, number, number]> = [];
  const add = (x1: number, y1: number, x2: number, y2: number) => {
    const edge: [number, number, number, number] = [x1, y1, x2, y2];
    edges.push(edge);
    const key = pointKey(x1, y1);
    const list = outgoing.get(key) ?? [];
    list.push(edge);
    outgoing.set(key, list);
  };
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height
      ? labels[y * width + x]
      : 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (at(x, y) !== componentLabel) continue;
      if (at(x, y - 1) !== componentLabel) add(x, y, x + 1, y);
      if (at(x + 1, y) !== componentLabel) add(x + 1, y, x + 1, y + 1);
      if (at(x, y + 1) !== componentLabel) add(x + 1, y + 1, x, y + 1);
      if (at(x - 1, y) !== componentLabel) add(x, y + 1, x, y);
    }
  }

  const used = new Set<string>();
  const rings: GridPoint[][] = [];
  for (const start of edges) {
    if (used.has(edgeKey(...start))) continue;
    const ring: GridPoint[] = [{ x: start[0], y: start[1] }];
    let edge = start;
    while (true) {
      used.add(edgeKey(...edge));
      ring.push({ x: edge[2], y: edge[3] });
      if (edge[2] === start[0] && edge[3] === start[1]) break;
      const candidates = (outgoing.get(pointKey(edge[2], edge[3])) ?? []).filter(
        (candidate) => !used.has(edgeKey(...candidate)),
      );
      if (candidates.length === 0) break;
      const currentDirection = direction(edge);
      candidates.sort((a, b) => {
        const turnA = (direction(a) - currentDirection + 4) % 4;
        const turnB = (direction(b) - currentDirection + 4) % 4;
        const rank = (turn: number) => [1, 0, 3, 2].indexOf(turn);
        return rank(turnA) - rank(turnB);
      });
      edge = candidates[0]!;
    }
    if (ring.length >= 4 && ring.at(-1)?.x === ring[0]?.x && ring.at(-1)?.y === ring[0]?.y) {
      ring.pop();
      rings.push(ring);
    }
  }

  const outer = rings.sort(
    (a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)),
  )[0];
  if (!outer || outer.length < 3) return null;
  let simplified = simplifyClosed(outer, Math.max(1.5, Math.min(width, height) * 0.0012));
  for (let tolerance = 2; simplified.length > 80 && tolerance <= 12; tolerance += 2) {
    simplified = simplifyClosed(outer, tolerance);
  }
  if (simplified.length < 3) return null;
  return {
    type: "polygon" as const,
    points: simplified.map((point) => ({
      x: Math.min(1, Math.max(0, point.x / width)),
      y: Math.min(1, Math.max(0, point.y / height)),
    })),
  };
}

/**
 * Extract the new, saturated fills that Imagine added to the complete page.
 * Existing colors in the architectural source are removed by source/output
 * differencing before connected components are converted into polygons.
 */
export async function extractImagineRoomRegions(
  sourceImage: Buffer,
  coloredImage: Buffer,
): Promise<ImagineRoomRegion[]> {
  const colored = await rawRgb(coloredImage);
  const source = await rawRgb(sourceImage, colored.width, colored.height);
  const pixels = colored.width * colored.height;
  const classes = new Uint8Array(pixels);
  for (let index = 0; index < pixels; index += 1) {
    classes[index] = classifyColoredPixel(source, colored, index);
  }

  const labels = new Int32Array(pixels);
  const components: Component[] = [];
  let nextLabel = 1;
  const queue = new Int32Array(pixels);
  for (let start = 0; start < pixels; start += 1) {
    const seedClass = classes[start]!;
    if (!seedClass || labels[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = nextLabel;
    const component: Component = {
      label: nextLabel,
      pixelCount: 0,
      sumX: 0,
      sumY: 0,
      sumR: 0,
      sumG: 0,
      sumB: 0,
    };
    while (head < tail) {
      const index = queue[head++]!;
      const x = index % colored.width;
      const y = Math.floor(index / colored.width);
      const offset = pixelOffset(colored, index);
      component.pixelCount += 1;
      component.sumX += x + 0.5;
      component.sumY += y + 0.5;
      component.sumR += colored.data[offset] ?? 0;
      component.sumG += colored.data[offset + 1] ?? 0;
      component.sumB += colored.data[offset + 2] ?? 0;
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < colored.width ? index + 1 : -1,
        y > 0 ? index - colored.width : -1,
        y + 1 < colored.height ? index + colored.width : -1,
      ];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || labels[neighbor] || !classes[neighbor]) continue;
        if (
          circularDistance(classes[neighbor]! - 1, seedClass - 1, HUE_BUCKETS) > 1
        ) {
          continue;
        }
        labels[neighbor] = nextLabel;
        queue[tail++] = neighbor;
      }
    }
    components.push(component);
    nextLabel += 1;
  }

  const minimum = Math.max(64, Math.round(pixels * MIN_COMPONENT_RATIO));
  const maximum = Math.round(pixels * MAX_COMPONENT_RATIO);
  const kept = components
    .filter(
      (component) =>
        component.pixelCount >= minimum && component.pixelCount <= maximum,
    )
    .flatMap((component) => {
      const shape = componentPolygon(
        labels,
        component.label,
        colored.width,
        colored.height,
      );
      if (!shape) return [];
      return [{ component, shape }];
    })
    .sort(
      (a, b) =>
        a.component.sumY / a.component.pixelCount -
          b.component.sumY / b.component.pixelCount ||
        a.component.sumX / a.component.pixelCount -
          b.component.sumX / b.component.pixelCount,
    );

  return kept.map(({ component, shape }, index) => ({
    id: index + 1,
    pixelCount: component.pixelCount,
    color: {
      r: Math.round(component.sumR / component.pixelCount),
      g: Math.round(component.sumG / component.pixelCount),
      b: Math.round(component.sumB / component.pixelCount),
    },
    centroid: {
      x: component.sumX / component.pixelCount / colored.width,
      y: component.sumY / component.pixelCount / colored.height,
    },
    shape,
  }));
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Add stable region numbers for Grok 4.6 to map back to room labels. */
export async function annotateImagineRoomRegions(
  coloredImage: Buffer,
  regions: ImagineRoomRegion[],
  options: { offsetRadii?: number } = {},
) {
  const metadata = await sharp(coloredImage).metadata();
  const width = metadata.width ?? 2048;
  const height = metadata.height ?? 1536;
  const radius = Math.max(10, Math.round(Math.min(width, height) * 0.009));
  const fontSize = Math.max(11, Math.round(radius * 1.15));
  // Badges sit on the centroid of the colored page, but printed room labels also
  // sit near the centroid, so the legible original page gets its badges nudged
  // clear of the label it needs the model to read.
  const shift = radius * (options.offsetRadii ?? 0);
  const badges = regions
    .map((region) => {
      const x = region.centroid.x * width + shift;
      const y = region.centroid.y * height - shift;
      return `<g><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius}" fill="#ffffff" stroke="#000000" stroke-width="3"/><text x="${x.toFixed(1)}" y="${(y + fontSize * 0.35).toFixed(1)}" font-family="Arial,sans-serif" font-weight="700" font-size="${fontSize}" text-anchor="middle" fill="#000000">${escapeXml(String(region.id))}</text></g>`;
    })
    .join("");
  const overlay = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${badges}</svg>`,
  );
  return sharp(coloredImage).composite([{ input: overlay }]).png().toBuffer();
}

export function parseImagineRoomAssignments(
  payload: unknown,
  validRegionIds: Set<number>,
): ImagineRoomAssignment[] {
  if (!payload || typeof payload !== "object") return [];
  const raw = (payload as { regions?: unknown }).regions;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const assignments: ImagineRoomAssignment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = Number(record.id);
    if (!Number.isInteger(id) || !validRegionIds.has(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const include = record.include !== false;
    const rawName = String(record.name ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const name = rawName.slice(0, 80) || `Room ${id}`;
    const confidence = Math.min(1, Math.max(0, Number(record.confidence) || 0));
    assignments.push({ id, name, include, confidence });
  }
  return assignments;
}
