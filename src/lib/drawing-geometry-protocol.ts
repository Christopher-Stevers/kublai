import type {
  PipeSymbolTemplate,
  PipeComponentsResult,
} from "./pipe-components-types";
import type {
  PipeLinework,
  PipeSegment,
  PipeSystemSelection,
} from "./pipe-system";
import type { SnapIndex, SnapSegment } from "./sheet-snap";
import type { SheetPoint } from "./sheet-measure";

export type PipeGeometryInfo = {
  codes: string[];
  layerCodes: string[];
  hasLines: boolean;
};
export type GeometryRequest =
  | { id: number; kind: "snap-chunk"; segments: SnapSegment[] }
  | { id: number; kind: "snap"; aspect: number }
  | { id: number; kind: "pipe-start"; linework: PipeLinework }
  | { id: number; kind: "pipe-chunk"; segments: PipeSegment[] }
  | { id: number; kind: "pipe-load" }
  | { id: number; kind: "pipe-layer"; system: string }
  | { id: number; kind: "pipe-components"; templates: PipeSymbolTemplate[] }
  | {
      id: number;
      kind: "pipe-select";
      point: SheetPoint;
      tolerance: number;
      system?: string;
    };
export type GeometryValue =
  | SnapIndex
  | PipeGeometryInfo
  | PipeSystemSelection
  | PipeComponentsResult
  | null;
export type GeometryResponse = { id: number } & (
  | { ok: true; value: GeometryValue }
  | { ok: false; error: string }
);
