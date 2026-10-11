import type {
  PipeLinework,
  PipeSegment,
  PipeSystemSelection,
} from "./pipe-system";
import type { SnapIndex, SnapSegment } from "./sheet-snap";
import type { SheetPoint } from "./sheet-measure";

export type PipeGeometryInfo = { codes: string[]; hasLines: boolean };
export type GeometryRequest =
  | { id: number; kind: "snap-chunk"; segments: SnapSegment[] }
  | { id: number; kind: "snap"; aspect: number }
  | { id: number; kind: "pipe-start"; linework: PipeLinework }
  | { id: number; kind: "pipe-chunk"; segments: PipeSegment[] }
  | { id: number; kind: "pipe-load" }
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
  | null;
export type GeometryResponse = { id: number } & (
  | { ok: true; value: GeometryValue }
  | { ok: false; error: string }
);
