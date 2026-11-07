import type { DrawingJobSheet, DrawingMetadata } from "./drawing-workspace";
import type { SheetScale } from "./sheet-measure";
import type { GridRead } from "./super-scale";
export type SuperScaleResult = {
  sheet: DrawingJobSheet;
  ownerId: string;
  metadata: DrawingMetadata;
  grids?: GridRead;
  scale?: SheetScale;
  selected: boolean;
  status: string;
  saved?: boolean;
};
export type SuperScaleOutput = {
  reference: GridRead;
  revision: number;
  sourceId: string;
  first: string;
  second: string;
  rows: SuperScaleResult[];
};
