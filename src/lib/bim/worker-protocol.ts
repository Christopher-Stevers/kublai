import type { BimElement, BimProperties } from "./types";
export type IfcPart = {
  expressId: number;
  vertices: Float32Array;
  indices: Uint32Array;
  matrix: number[];
  color: [number, number, number, number];
};
export type IfcRequest =
  | { type: "load"; modelId: string; url: string }
  | {
      type: "properties";
      modelId: string;
      expressId: number;
      requestId: number;
    }
  | { type: "close"; modelId: string };
export type IfcReply =
  | { type: "progress"; modelId: string; progress: number; message: string }
  | {
      type: "geometry";
      modelId: string;
      parts: IfcPart[];
      elements: BimElement[];
    }
  | { type: "ready"; modelId: string; elements: BimElement[]; schema: string }
  | {
      type: "properties";
      modelId: string;
      requestId: number;
      properties: BimProperties;
    }
  | { type: "error"; modelId: string; message: string; requestId?: number };
