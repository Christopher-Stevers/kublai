import type { BimElement, BimProperties } from "./types";
export type IfcPart = {
  expressId: number;
  geometryId: number;
  positions: Float32Array;
  normals: Int16Array;
  indices: Uint32Array | Uint16Array;
  matrix: number[];
  color: [number, number, number, number];
};
export type IfcRequest =
  | {
      type: "load";
      modelId: string;
      loadId: number;
      url: string;
      installedApp?: boolean;
    }
  | { type: "ack"; modelId: string; loadId: number; chunkId: number }
  | {
      type: "properties";
      modelId: string;
      expressId: number;
      requestId: number;
    }
  | { type: "close"; modelId: string };
export type IfcReply =
  | {
      type: "progress";
      modelId: string;
      loadId: number;
      progress: number;
      message: string;
    }
  | {
      type: "geometry";
      modelId: string;
      loadId: number;
      chunkId: number;
      parts: IfcPart[];
      elements: BimElement[];
    }
  | {
      type: "ready";
      modelId: string;
      loadId: number;
      elements: BimElement[];
      schema: string;
    }
  | {
      type: "properties";
      modelId: string;
      requestId: number;
      properties: BimProperties;
    }
  | {
      type: "error";
      modelId: string;
      message: string;
      loadId?: number;
      requestId?: number;
    };
