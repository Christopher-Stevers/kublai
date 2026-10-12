import {
  IFCOPENINGELEMENT,
  IFCOPENINGSTANDARDCASE,
  IFCSPACE,
  type IfcAPI,
  type Vector,
} from "web-ifc";
import { compactGeometry } from "./compact-geometry";
import type { IfcPart } from "./worker-protocol";

/** web-ifc's declaration omits the Embind vector destructor. */
export function releaseVector(value: Vector<unknown>) {
  (value as Vector<unknown> & { delete?: () => void }).delete?.();
}

/** Match StreamAllMeshes' exclusions, but allow yielding between elements. */
export function viewableElementIds(api: IfcAPI, model: number) {
  const ids: number[] = [];
  for (const type of api.GetIfcEntityList(model)) {
    if (
      !api.IsIfcElement(type) ||
      type === IFCOPENINGELEMENT ||
      type === IFCOPENINGSTANDARDCASE ||
      type === IFCSPACE
    )
      continue;
    const lines = api.GetLineIDsWithType(model, type);
    try {
      for (let i = 0; i < lines.size(); i++) ids.push(lines.get(i));
    } finally {
      releaseVector(lines);
    }
  }
  return ids;
}

/** Buffers may be shared by repeated placements within one transferred chunk. */
export function readMeshParts(
  api: IfcAPI,
  model: number,
  expressId: number,
  cache: Map<number, ReturnType<typeof compactGeometry>>,
) {
  const parts: IfcPart[] = [];
  // web-ifc 0.0.78's browser StreamMeshes binding accepts three arguments,
  // while its JS wrapper passes four. GetFlatMesh is the public per-element API.
  const mesh = api.GetFlatMesh(model, expressId);
  try {
    for (let i = 0; i < mesh.geometries.size(); i++) {
      const placed = mesh.geometries.get(i);
      let buffers = cache.get(placed.geometryExpressID);
      if (!buffers) {
        const geometry = api.GetGeometry(model, placed.geometryExpressID);
        try {
          buffers = compactGeometry(
            api.GetVertexArray(
              geometry.GetVertexData(),
              geometry.GetVertexDataSize(),
            ),
            api.GetIndexArray(
              geometry.GetIndexData(),
              geometry.GetIndexDataSize(),
            ),
          );
          cache.set(placed.geometryExpressID, buffers);
        } finally {
          geometry.delete();
        }
      }
      if (!buffers.indices.length) continue;
      parts.push({
        expressId,
        geometryId: placed.geometryExpressID,
        ...buffers,
        matrix: placed.flatTransformation,
        color: [placed.color.x, placed.color.y, placed.color.z, placed.color.w],
      });
    }
  } finally {
    releaseVector(mesh.geometries);
    api.ResetCache(model);
  }
  return parts;
}
