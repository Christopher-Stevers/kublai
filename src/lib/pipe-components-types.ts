import type { SheetPoint } from "./sheet-measure";
export const PIPE_COMPONENT_KINDS = [
  "valve",
  "elbow",
  "tee",
  "reducer",
  "coupling",
  "cap",
  "other",
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
  reference?: {
    paths: PipeSymbolPath[];
    aspect: number;
    abbreviation: string;
    sheetName: string;
    sourceSheetId: string;
    legendId: string;
    revision: number;
  };
  excludeFromTarget?: boolean;
};
export type PipeLegendReferences = {
  templates: PipeSymbolTemplate[];
  warnings: string[];
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
  other: "Other component",
};
