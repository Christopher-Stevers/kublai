/** Painted vector evidence only. Eligibility is not a wall, door or room label. */
export interface Point {
  x: number;
  y: number;
}
export type Matrix = [number, number, number, number, number, number];
export interface LineEvidence {
  id: string;
  a: Point;
  b: Point;
  pathId: string;
  eligible: boolean;
  reasons: string[];
}
export interface ArcEvidence {
  id: string;
  pathId: string;
  points: Point[];
  eligible: boolean;
  reasons: string[];
  representation?: "native-curve" | "contiguous-line-run";
  /** Exact indices into this path's original command array; never gap-joined. */
  sourceCommandIndices?: number[];
}
export interface PathCommand {
  kind: "move" | "line" | "cubic" | "quadratic" | "close";
  operatorIndex: number;
  nativeOperands: number[];
  /** Includes segment start and every control/end point, in scale-1 viewport points. */
  points: Point[];
  ctm: Matrix;
}
export interface ClipRectangle {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  operatorIndex: number;
}
export interface GraphicsState {
  ctm: Matrix;
  lineWidth: number;
  lineCap: number;
  lineJoin: number;
  miterLimit: number;
  dash: number[];
  dashPhase: number;
  strokeColor: unknown;
  fillColor: unknown;
  strokeAlpha: number;
  fillAlpha: number;
  blendMode: unknown;
  softMask: unknown;
  transfer: unknown;
  renderingIntent: unknown;
  flatness: number;
  strokeColorSpace: unknown;
  fillColorSpace: unknown;
  clips: ClipRectangle[];
  unresolvedClip: boolean;
  reasons: string[];
  /** Exact finite serializable graphics-state operations affecting this state. */
  provenance: { operatorIndex: number; operator: string; args: unknown[] }[];
}
export interface PaintedPath {
  id: string;
  sourceSha256: string;
  pageIndex: number;
  paintOperator: string;
  paintOperatorIndex: number;
  rawConstructPath: unknown[] | null;
  commands: PathCommand[];
  graphicsState: GraphicsState;
  markedContent: { tag: string; properties: unknown; operatorIndex: number }[];
  formOperators: number[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  eligible: boolean;
  reasons: string[];
}
export interface ParsedPage {
  schemaVersion: "painted-page-evidence-v1";
  sourceSha256: string;
  pageIndex: number;
  width: number;
  height: number;
  paths: PaintedPath[];
  lines: LineEvidence[];
  arcs: ArcEvidence[];
  diagnostics: {
    pdfjsVersion: string;
    operatorCount: number;
    commandCount: number;
    sampledPointCount: number;
    eligibleLines: number;
    eligibleArcs: number;
    reasonCounts: Record<string, number>;
    ignoredOperatorCounts: Record<string, number>;
    viewportTransform: Matrix;
    coordinateSystem: "scale-1-viewport-page-points";
    limits: Record<string, number>;
    /** Complete unique graphics-state/form/clip operation stream, in source order. */
    graphicsOperations: GraphicsState["provenance"];
    occlusionOperations: {
      operatorIndex: number;
      operator: string;
      bounds: PaintedPath["bounds"];
      affectedEvidence: number;
    }[];
    visibilityLimitations: string[];
  };
}
export interface OperatorListInput {
  sourceSha256: string;
  pageIndex: number;
  width: number;
  height: number;
  viewportTransform: Matrix;
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown>;
  pdfjsVersion?: string;
}
