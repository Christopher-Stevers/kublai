import { buildSnapIndex, mergeCollinear, type SnapSegment } from "./sheet-snap";
import {
  buildPipeSystemIndex,
  selectPipeSystem,
  selectPipeLayerSystem,
  pipeLayerCodes,
  type PipeLinework,
  type PipeSystemIndex,
} from "./pipe-system";
import type {
  GeometryRequest,
  GeometryResponse,
  PipeGeometryInfo,
} from "./drawing-geometry-protocol";

// PDF parsing retains its existing worker. This worker owns the expensive
// spatial graph, including its reusable connection caches, away from touch input.
let pipes: PipeSystemIndex | null = null;
let linework: PipeLinework | null = null;
let snaps: SnapSegment[] = [];
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<GeometryRequest>) => void) | null;
  postMessage: (response: GeometryResponse) => void;
};
scope.onmessage = ({ data }) => {
  try {
    switch (data.kind) {
      case "snap-chunk":
        snaps.push(...data.segments);
        scope.postMessage({ id: data.id, ok: true, value: null });
        break;
      case "snap":
        scope.postMessage({
          id: data.id,
          ok: true,
          value: buildSnapIndex(
            mergeCollinear(snaps, data.aspect),
            data.aspect,
          ),
        });
        snaps = [];
        break;
      case "pipe-start":
        pipes = null;
        linework = data.linework;
        scope.postMessage({ id: data.id, ok: true, value: null });
        break;
      case "pipe-chunk":
        if (!linework) throw new Error("The drawing lines are not ready.");
        linework.segments.push(...data.segments);
        scope.postMessage({ id: data.id, ok: true, value: null });
        break;
      case "pipe-load": {
        if (!linework) throw new Error("The drawing lines are not ready.");
        pipes = buildPipeSystemIndex(linework);
        linework = null;
        const info: PipeGeometryInfo = {
          layerCodes: pipeLayerCodes(pipes.linework),
          codes: [
            ...new Set(
              [...pipeLayerCodes(pipes.linework), ...[...pipes.segmentSystems.values()].flatMap((codes) => [...codes])],
            ),
          ].sort(),
          hasLines: pipes.linework.segments.length > 0,
        };
        scope.postMessage({ id: data.id, ok: true, value: info });
        break;
      }
      case "pipe-select":
        if (!pipes) throw new Error("The drawing lines are not ready.");
        scope.postMessage({
          id: data.id,
          ok: true,
          value: selectPipeSystem(
            pipes,
            data.point,
            data.tolerance,
            data.system,
          ),
        });
        break;
      case "pipe-layer":
        if (!pipes) throw new Error("The drawing lines are not ready.");
        scope.postMessage({ id: data.id, ok: true, value: selectPipeLayerSystem(pipes.linework, data.system) });
        break;
    }
  } catch (error) {
    scope.postMessage({
      id: data.id,
      ok: false,
      error:
        error instanceof Error ? error.message : "Drawing geometry failed.",
    });
  }
};
