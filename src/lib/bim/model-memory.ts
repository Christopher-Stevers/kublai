import type { IfcPart } from "./worker-protocol";
const MiB = 1024 * 1024;

/** Budget geometry copies on both CPU and GPU, leaving room for the IFC parser. */
export function modelMemoryBudget(deviceMemory?: number, mobile = false) {
  if (deviceMemory && deviceMemory <= 2) return 256 * MiB;
  if (mobile || (deviceMemory && deviceMemory <= 4)) return 384 * MiB;
  return 768 * MiB;
}

export function planModelBatches(parts: IfcPart[]) {
  return [false, true]
    .map((transparent) => {
      const group = parts.filter(
        (p) => p.color[3] < 0.99 === transparent && p.indices.length,
      );
      const unique = new Map(group.map((part) => [part.geometryId, part]));
      let vertices = 0,
        indices = 0;
      for (const part of unique.values()) {
        vertices += part.positions.length / 3;
        indices += part.indices.length;
      }
      // BatchedMesh uses 32-bit indices when its combined buffer exceeds 65,535 vertices.
      const geometryBytes =
        vertices * 18 + indices * (vertices > 65535 ? 4 : 2);
      // Include matrix/colour/indirect textures and their CPU backing stores.
      // Include the CPU spatial index as well as instance/rendering textures.
      const bytes = geometryBytes * 2 + group.length * 512;
      return { group, transparent, vertices, indices, bytes };
    })
    .filter((batch) => batch.group.length);
}
