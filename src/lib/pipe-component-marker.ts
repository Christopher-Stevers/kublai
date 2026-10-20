import { pipeFittingProfile } from "./pipe-fitting-profile";
import { z } from "zod";
import type {
  PipeComponentCandidate,
  PipeComponentKind,
  PipeSymbolPath,
} from "./pipe-components-types";
import type { SheetPoint } from "./sheet-measure";

const coordinate = z.number().finite().min(-1).max(1);
export const pipeComponentMarkerSchema = z
  .object({
    paths: z
      .array(
        z.object({
          points: z
            .array(z.object({ x: coordinate, y: coordinate }))
            .min(2)
            .max(512),
          closed: z.boolean(),
        }),
      )
      .min(1)
      .max(100),
    span: z.number().finite().min(0.00001).max(0.16),
    label: z.string().max(8).optional(),
    legendId: z.string().max(100).optional(),
  })
  .refine(
    (value) =>
      value.paths.reduce((sum, path) => sum + path.points.length, 0) <= 2000,
    "Symbol is too complex",
  );
export type PipeComponentMarker = z.infer<typeof pipeComponentMarkerSchema>;

/** A compact vector snapshot: no extra image requests, stable after a legend edit. */
export function vectorComponentMarker(
  paths: PipeSymbolPath[],
  aspect: number,
  legendId?: string,
): PipeComponentMarker | undefined {
  if (
    !Number.isFinite(aspect) ||
    aspect <= 0 ||
    !paths.length ||
    paths.length > 100 ||
    paths.some((p) => p.points.length < 2 || p.points.length > 512) ||
    paths.reduce((n, p) => n + p.points.length, 0) > 2000
  )
    return;
  const points = paths.flatMap((p) => p.points);
  const left = Math.min(...points.map((p) => p.x)),
    right = Math.max(...points.map((p) => p.x));
  const top = Math.min(...points.map((p) => p.y)),
    bottom = Math.max(...points.map((p) => p.y));
  const span = Math.max(right - left, (bottom - top) * aspect);
  if (!Number.isFinite(span) || span <= 0 || span > 0.16) return;
  const result = pipeComponentMarkerSchema.safeParse({
    span,
    legendId,
    paths: paths.map((p) => ({
      closed: p.closed,
      points: p.points.map((q) => ({
        x: Math.max(-1, Math.min(1, ((q.x - (left + right) / 2) * 2) / span)),
        y: Math.max(
          -1,
          Math.min(1, ((q.y - (top + bottom) / 2) * aspect * 2) / span),
        ),
      })),
    })),
  });
  return result.success ? result.data : undefined;
}

const CUSTOM_COMPONENT_SPAN = 0.002;

export function customComponentMarker(
  kind: PipeComponentKind,
  name: string,
  rays?: SheetPoint[],
): PipeComponentMarker {
  const path = (points: number[][], closed = false) => ({
    points: points.map(([x, y]) => ({ x: x!, y: y! })),
    closed,
  });
  const circle = path(
    Array.from({ length: 25 }, (_, i) => [
      Math.cos((i * Math.PI) / 12) * 0.8,
      Math.sin((i * Math.PI) / 12) * 0.8,
    ]),
    true,
  );
  const marker: PipeComponentMarker = {
    span: CUSTOM_COMPONENT_SPAN,
    paths: [],
  };
  const angle = /(?:^|\s)(90|45|22(?:\.5)?)(?=\s*(?:°|deg|elbow|bend))/i.exec(
    name,
  )?.[1];
  const profile = pipeFittingProfile(name);
  if (profile?.direction) {
    const up = profile.direction !== "down",
      down = profile.direction !== "up";
    marker.paths = [
      circle,
      path([
        [0, -0.55],
        [0, 0.55],
      ]),
    ];
    if (up)
      marker.paths.push(
        path([
          [-0.3, -0.2],
          [0, -0.55],
          [0.3, -0.2],
        ]),
      );
    if (down)
      marker.paths.push(
        path([
          [-0.3, 0.2],
          [0, 0.55],
          [0.3, 0.2],
        ]),
      );
    if (kind === "tee")
      marker.paths.push(
        path([
          [-1, 0],
          [-0.8, 0],
        ]),
        path([
          [0.8, 0],
          [1, 0],
        ]),
      );
    const direction =
      profile.direction === "up"
        ? "UP"
        : profile.direction === "down"
          ? "DN"
          : "UP/DN?";
    marker.label =
      profile.direction === "unknown"
        ? direction
        : kind === "tee"
          ? `T ${direction}`
          : kind === "elbow"
            ? `${angle ?? "90"}° ${direction}`
            : direction;
  } else if (kind === "elbow" || kind === "tee") {
    const bend =
      (Number(angle === "22" ? "22.5" : (angle ?? 90)) * Math.PI) / 180;
    const arms = rays?.length
      ? rays
      : kind === "tee"
        ? [
            { x: -1, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: -1 },
          ]
        : [
            { x: -1, y: 0 },
            { x: Math.cos(bend), y: -Math.sin(bend) },
          ];
    marker.paths = arms.map((r) =>
      path([
        [0, 0],
        [r.x * 0.85, r.y * 0.85],
      ]),
    );
    marker.label =
      kind === "tee"
        ? "T"
        : angle
          ? `${angle === "22" ? "22.5" : angle}°`
          : "?";
  } else if (kind === "rise" || kind === "drop") {
    marker.paths = [
      circle,
      ...(kind === "rise"
        ? [
            path([
              [0, -0.55],
              [0, 0.55],
            ]),
            path([
              [-0.38, -0.1],
              [0, -0.55],
              [0.38, -0.1],
            ]),
          ]
        : [
            path([
              [0, -0.55],
              [0, 0.55],
            ]),
            path([
              [-0.38, 0.1],
              [0, 0.55],
              [0.38, 0.1],
            ]),
          ]),
    ];
    marker.label = kind === "rise" ? "UP" : "DN";
  } else {
    // A neutral diamond must not invent a particular valve/symbol meaning.
    marker.paths = [
      path(
        [
          [0, -0.8],
          [0.8, 0],
          [0, 0.8],
          [-0.8, 0],
          [0, -0.8],
        ],
        true,
      ),
    ];
    marker.label = "?";
  }
  return marker;
}
export function componentMarker(
  candidate: Pick<PipeComponentCandidate, "kind" | "name" | "marker">,
): PipeComponentMarker {
  const marker =
    candidate.marker ?? customComponentMarker(candidate.kind, candidate.name);
  // Apply the compact size to previously saved generated symbols too. Actual
  // legend snapshots have no generated label and retain their source size.
  return marker.label && !marker.legendId && marker.span === 0.006
    ? { ...marker, span: CUSTOM_COMPONENT_SPAN }
    : marker;
}
export function pipeComponentColor(pipe: string): string {
  const rgb = (value: string) =>
    [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) || 0);
  const source = rgb(pipe);
  return ["#fbbf24", "#a855f7", "#06b6d4"].sort((a, b) => {
    const distance = (color: string) =>
      rgb(color).reduce((sum, c, i) => sum + (c - source[i]!) ** 2, 0);
    return distance(b) - distance(a);
  })[0]!;
}
export function componentMarkerPath(
  marker: PipeComponentMarker,
  x: number,
  y: number,
  span = marker.span * 1000,
): string {
  return marker.paths
    .map(
      (path) =>
        path.points
          .map(
            (p, i) =>
              `${i ? "L" : "M"} ${x + (p.x * span) / 2} ${y + (p.y * span) / 2}`,
          )
          .join(" ") + (path.closed ? " Z" : ""),
    )
    .join(" ");
}
