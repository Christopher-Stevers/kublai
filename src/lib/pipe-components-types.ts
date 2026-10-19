import type { SheetPoint } from "./sheet-measure";
export const PIPE_COMPONENT_KINDS = [
  "valve",
  "elbow",
  "tee",
  "reducer",
  "coupling",
  "cap",
] as const;
export type PipeComponentKind = (typeof PIPE_COMPONENT_KINDS)[number];
export type PipeComponentBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export type PipeSymbolPath = {
  id: string;
  points: SheetPoint[];
  closed: boolean;
  layer?: string;
};
export type PipeDrawingText = PipeComponentBox & { text: string };
export type PipeSymbolTemplate = {
  id: string;
  kind: PipeComponentKind;
  name: string;
  box: PipeComponentBox;
};
export type PipeComponentCandidate = {
  id: string;
  kind: PipeComponentKind;
  name: string;
  point: SheetPoint;
  box: PipeComponentBox;
  source: "layer" | "tag" | "legend" | "geometry";
  evidence: string;
  size?: string;
  material?: string;
  tag?: string;
  system: string | null;
  fingerprint: string;
};
export type PipeComponentsResult = {
  candidates: PipeComponentCandidate[];
  warnings: string[];
  partial: boolean;
};
export const PIPE_COMPONENT_NAMES: Record<PipeComponentKind, string> = {
  valve: "Valve",
  elbow: "Elbow",
  tee: "Tee / branch",
  reducer: "Reducer",
  coupling: "Coupling",
  cap: "Cap",
};
