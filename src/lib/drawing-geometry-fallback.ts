import { analyzePipeComponents } from "./pipe-components";
import { buildSnapIndex, mergeCollinear, type SnapIndex, type SnapSegment } from "./sheet-snap";
import { buildPipeSystemIndex, selectPipeSystem, selectPipeLayerSystem, pipeLayerCodes, type PipeLinework, type PipeSystemIndex, type PipeSystemSelection } from "./pipe-system";
import { pipeSizeTags } from "./pipe-run-sizes";
import type { PipeGeometrySession } from "./drawing-geometry-client";

export function buildFallbackSnapIndex(segments: SnapSegment[], aspect: number): SnapIndex {
  return buildSnapIndex(mergeCollinear(segments, aspect), aspect);
}
export function createFallbackPipeSession(
  linework: PipeLinework,
  register: (session: {dispose: () => void}) => () => void,
  aborted: () => DOMException,
): PipeGeometrySession {
  let unregister: () => void = () => undefined;
  let index: PipeSystemIndex | null = buildPipeSystemIndex(linework);
  let selection: PipeSystemSelection | null = null;
  const session: PipeGeometrySession = {
    aspect: linework.aspect,
    sizeTags: pipeSizeTags(linework.texts ?? []),
    components: async (templates) => {
      if (!index || !selection) throw aborted();
      return analyzePipeComponents(index.linework, selection, templates);
    },
    layerCodes: pipeLayerCodes(linework),
    selectLayer: async (system) => {
      if (!index) throw aborted();
      selection = selectPipeLayerSystem(index.linework, system);
      return selection;
    },
    codes: [
      ...new Set([
        ...pipeLayerCodes(index.linework),
        ...[...index.segmentSystems.values()].flatMap((codes) => [...codes]),
      ]),
    ].sort(),
    hasLines: index.linework.segments.length > 0,
    select: async (point, tolerance, system) => {
      if (!index) throw aborted();
      selection = selectPipeSystem(index, point, tolerance, system);
      return selection;
    },
    dispose: () => {
      index = null;
      unregister();
    },
  };
  unregister = register(session);
  return session;
}
