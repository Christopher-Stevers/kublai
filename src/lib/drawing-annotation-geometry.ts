import type {
  DrawingMarkup,
  DrawingPoint,
  DrawingTool,
} from "./drawing-workspace";
import { formatLength, realLength, type SheetScale } from "./sheet-measure";

export const DRAWING_SVG_WIDTH = 1000;
export type DrawingResizeHandle = "nw" | "ne" | "sw" | "se";
export type DrawingBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));
/** Older annotations retain their original text size until explicitly resized. */
export function drawingFontSize(
  data: Pick<DrawingMarkup, "fontSize" | "width">,
) {
  return data.fontSize ?? Math.max(18, 14 + data.width * 2);
}
export const isStrokeTool = (tool: DrawingTool) =>
  tool === "freehand" || tool === "highlight";
export const isPathTool = (tool: DrawingTool) =>
  ["polyline", "polycloud", "area", "angle", "count"].includes(tool);
export function minimumDrawingPoints(type: DrawingTool) {
  return ["text", "count", "issue", "rfi"].includes(type)
    ? 1
    : ["area", "polycloud", "angle"].includes(type)
      ? 3
      : 2;
}
export function drawingBounds(points: DrawingPoint[]) {
  const xs = points.map((point) => point.x),
    ys = points.map((point) => point.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}
function textDimensions(data: DrawingMarkup, aspect: number) {
  const fontSize = drawingFontSize(data);
  const lines = (data.text?.length ? data.text : "Text").split("\n");
  // Browser and PDF fonts differ slightly; a glyph estimate keeps handles useful
  // without relying on canvas, the DOM, or a particular device's font metrics.
  const longest = Math.max(
    1,
    ...lines.map((line) =>
      Array.from(line).reduce(
        (width, char) =>
          width +
          (/\s/.test(char)
            ? 0.32
            : /[ilI.,'!|]/.test(char)
              ? 0.28
              : /[MW@#]/.test(char)
                ? 0.85
                : 0.58),
        0,
      ),
    ),
  );
  return {
    width: (longest * fontSize) / DRAWING_SVG_WIDTH,
    height:
      ((1 + (lines.length - 1) * 1.25) * fontSize) /
      (DRAWING_SVG_WIDTH * aspect),
    fontSize,
  };
}
function usableDrawingBounds(bounds: DrawingBounds, aspect: number) {
  // A cropped note, horizontal line, or single count still needs distinct,
  // reachable corners. Keep a small selection box inside the page edge.
  const pad = 8 / DRAWING_SVG_WIDTH;
  if (bounds.right - bounds.left < 0.000001) {
    bounds.left = clamp(bounds.left - pad / 2, 0, 1 - pad);
    bounds.right = bounds.left + pad;
  }
  const verticalPad = Math.min(1, Math.max(0.000001, pad / aspect));
  if (bounds.bottom - bounds.top < 0.000001) {
    bounds.top = clamp(bounds.top - verticalPad / 2, 0, 1 - verticalPad);
    bounds.bottom = bounds.top + verticalPad;
  }
  return bounds;
}
/** Normalized sheet bounds. Text includes its baseline and approximate glyph box. */
export function drawingMarkupBounds(
  data: DrawingMarkup,
  aspect: number,
): DrawingBounds {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  if (!data.points.length)
    return usableDrawingBounds(
      { left: 0, top: 0, right: 0, bottom: 0 },
      safeAspect,
    );
  if (data.type === "text") {
    const point = data.points[0]!;
    const dimensions = textDimensions(data, safeAspect);
    const top =
      point.y - (dimensions.fontSize * 0.8) / (DRAWING_SVG_WIDTH * safeAspect);
    return usableDrawingBounds(
      {
        left: clamp(point.x, 0, 1),
        top: clamp(top, 0, 1),
        right: clamp(point.x + dimensions.width, 0, 1),
        bottom: clamp(top + dimensions.height, 0, 1),
      },
      safeAspect,
    );
  }
  return usableDrawingBounds(drawingBounds(data.points), safeAspect);
}
/** Resize from one corner around the opposite corner, retaining every vertex. */
export function resizeDrawingMarkup(
  data: DrawingMarkup,
  handle: DrawingResizeHandle,
  point: DrawingPoint,
  aspect: number,
): DrawingMarkup {
  if (
    !data.points.length ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  )
    return data;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const original = drawingMarkupBounds(data, safeAspect);
  const west = handle.endsWith("w"),
    north = handle.startsWith("n");
  const anchor = {
    x: clamp(west ? original.right : original.left, 0, 1),
    y: clamp(north ? original.bottom : original.top, 0, 1),
  };
  const x = clamp(point.x, 0, 1),
    y = clamp(point.y, 0, 1);
  const minimum = 0.00001;
  const targetWidth = Math.max(minimum, west ? anchor.x - x : x - anchor.x);
  const targetHeight = Math.max(minimum, north ? anchor.y - y : y - anchor.y);
  const width = original.right - original.left,
    height = original.bottom - original.top;
  const availableWidth = west ? anchor.x : 1 - anchor.x;
  const availableHeight = north ? anchor.y : 1 - anchor.y;
  if (data.type === "text") {
    const dimensions = textDimensions(data, safeAspect);
    const requested = Math.min(
      targetWidth / dimensions.width,
      targetHeight / dimensions.height,
    );
    const pageLimit = Math.min(
      availableWidth / dimensions.width,
      availableHeight / dimensions.height,
    );
    const fontSize = clamp(
      dimensions.fontSize * Math.min(requested, pageLimit),
      6,
      300,
    );
    const scale = fontSize / dimensions.fontSize;
    const left = clamp(
      west ? anchor.x - dimensions.width * scale : anchor.x,
      0,
      Math.max(0, 1 - dimensions.width * scale),
    );
    const top = clamp(
      north ? anchor.y - dimensions.height * scale : anchor.y,
      0,
      Math.max(0, 1 - dimensions.height * scale),
    );
    const origin = {
      x: left,
      y: clamp(top + (fontSize * 0.8) / (DRAWING_SVG_WIDTH * safeAspect), 0, 1),
    };
    return {
      ...data,
      fontSize,
      points: data.points.map((p, index) => (index === 0 ? origin : p)),
    };
  }
  const nextWidth = Math.min(availableWidth, targetWidth),
    nextHeight = Math.min(availableHeight, targetHeight);
  const left = west ? anchor.x - nextWidth : anchor.x;
  const top = north ? anchor.y - nextHeight : anchor.y;
  return {
    ...data,
    points: data.points.map((p) => ({
      x: clamp(left + ((p.x - original.left) / width) * nextWidth, 0, 1),
      y: clamp(top + ((p.y - original.top) / height) * nextHeight, 0, 1),
    })),
  };
}
export function translateDrawingPoints(
  points: DrawingPoint[],
  delta: DrawingPoint,
) {
  const bounds = drawingBounds(points);
  const x = Math.min(1 - bounds.right, Math.max(-bounds.left, delta.x));
  const y = Math.min(1 - bounds.bottom, Math.max(-bounds.top, delta.y));
  return points.map((point) => ({ x: point.x + x, y: point.y + y }));
}
export function drawingArea(points: DrawingPoint[], aspect: number, scale = 1) {
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    twiceArea += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twiceArea) * 0.5 * aspect * scale * scale;
}
export function drawingAngle(points: DrawingPoint[], aspect: number) {
  if (points.length !== 3) return null;
  const [a, b, c] = points as [DrawingPoint, DrawingPoint, DrawingPoint];
  const ax = a.x - b.x,
    ay = (a.y - b.y) * aspect;
  const bx = c.x - b.x,
    by = (c.y - b.y) * aspect;
  const lengths = Math.hypot(ax, ay) * Math.hypot(bx, by);
  return lengths > 0
    ? (Math.acos(Math.min(1, Math.max(-1, (ax * bx + ay * by) / lengths))) *
        180) /
        Math.PI
    : null;
}
export function drawingMeasurement(
  data: DrawingMarkup,
  aspect: number,
  sharedScale?: SheetScale | null,
) {
  if (data.type === "count")
    return `${data.points.length} count${data.points.length === 1 ? "" : "s"}`;
  if (data.type === "angle") {
    const angle = drawingAngle(data.points, aspect);
    return angle === null ? "—" : `${angle.toFixed(1)}°`;
  }
  if (data.type !== "dimension" && data.type !== "area") return null;
  const scale = data.scale ?? sharedScale?.unitsPerSheetWidth;
  const unit = data.unit ?? sharedScale?.unit;
  if (!scale || !unit) return "Set scale";
  if (data.type === "area")
    return `${drawingArea(data.points, aspect, scale).toFixed(2)} ${unit}²`;
  const length = realLength(data.points, aspect, scale);
  return unit === "ft" || unit === "m"
    ? formatLength(length, unit)
    : `${length.toFixed(2)} ${unit}`;
}

/** Remove redundant sampled pen points with a bounded, iterative RDP pass. */
export function simplifyDrawingStroke(
  points: DrawingPoint[],
  tolerance: number,
  aspect: number,
) {
  if (points.length < 3) return points;
  const keep = new Set([0, points.length - 1]);
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    const a = points[start]!,
      b = points[end]!;
    const dx = b.x - a.x,
      dy = (b.y - a.y) * aspect,
      length = dx * dx + dy * dy;
    let furthest = -1,
      distance = tolerance * tolerance;
    for (let i = start + 1; i < end; i++) {
      const p = points[i]!;
      const px = p.x - a.x,
        py = (p.y - a.y) * aspect;
      const t = length
        ? Math.min(1, Math.max(0, (px * dx + py * dy) / length))
        : 0;
      const square = (px - t * dx) ** 2 + (py - t * dy) ** 2;
      if (square > distance) {
        distance = square;
        furthest = i;
      }
    }
    if (furthest >= 0) {
      keep.add(furthest);
      stack.push([start, furthest], [furthest, end]);
    }
  }
  return [...keep].sort((a, b) => a - b).map((index) => points[index]!);
}

/** Scallops follow the actual polygon, rather than a rectangular bounding box. */
export function drawingCloudPath(points: DrawingPoint[], aspect: number) {
  if (points.length < 2) return "";
  const vertices = points.map((point) => ({
    x: point.x * 1000,
    y: point.y * 1000 * aspect,
  }));
  const signed = vertices.reduce((area, point, i) => {
    const next = vertices[(i + 1) % vertices.length]!;
    return area + point.x * next.y - next.x * point.y;
  }, 0);
  const direction = signed >= 0 ? 1 : -1;
  let path = `M ${vertices[0]!.x} ${vertices[0]!.y}`;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!,
      b = vertices[(i + 1) % vertices.length]!;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      distance = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.min(80, Math.ceil(distance / 16)));
    const bulge = Math.min(10, (distance / steps) * 0.45);
    for (let j = 0; j < steps; j++) {
      const middle = (j + 0.5) / steps,
        end = (j + 1) / steps;
      path += ` Q ${a.x + dx * middle + (distance ? ((direction * dy) / distance) * bulge : 0)} ${a.y + dy * middle - (distance ? ((direction * dx) / distance) * bulge : 0)} ${a.x + dx * end} ${a.y + dy * end}`;
    }
  }
  return `${path} Z`;
}
