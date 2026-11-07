import { compactGeometryRust } from "../geometry-kernels";
/**
 * Preserve every triangle and the exact Float32 positions used for measurement.
 * Unit normals use normalized Int16 storage (under 0.003 degrees of error).
 * Index identical position/normal pairs, retaining distinct hard-edge normals.
 */
export function compactGeometry(vertices: Float32Array, indices: Uint32Array) {
  const accelerated = compactGeometryRust(vertices, indices);
  if (accelerated) return accelerated;
  return compactGeometryTypeScript(vertices, indices);
}

export function compactGeometryTypeScript(
  vertices: Float32Array,
  indices: Uint32Array,
) {
  const count = vertices.length / 6;
  if (!Number.isInteger(count) || indices.length % 3)
    throw Error("The model contains invalid geometry.");
  let capacity = 1;
  while (capacity < count * 2) capacity *= 2;
  const slots = new Uint32Array(capacity);
  const remap = new Uint32Array(count);
  const bits = new Uint32Array(
    vertices.buffer,
    vertices.byteOffset,
    vertices.length,
  );
  const positions = new Float32Array(count * 3);
  const positionBits = new Uint32Array(positions.buffer);
  const normals = new Int16Array(count * 3);
  const mapped = new Uint32Array(indices.length);
  let used = 0;
  for (let i = 0; i < indices.length; i++) {
    const original = indices[i]!;
    if (original >= count)
      throw Error("The model contains invalid triangle indices.");
    let target = remap[original]!;
    if (!target) {
      const offset = original * 6;
      for (let c = 0; c < 6; c++)
        if (!Number.isFinite(vertices[offset + c]))
          throw Error("The model contains non-finite geometry.");
      const x = bits[offset]!,
        y = bits[offset + 1]!,
        z = bits[offset + 2]!;
      const nx = vertices[offset + 3]!,
        ny = vertices[offset + 4]!,
        nz = vertices[offset + 5]!;
      const scale = 32767 / (Math.hypot(nx, ny, nz) || 1);
      const a = Math.round(nx * scale),
        b = Math.round(ny * scale),
        c = Math.round(nz * scale);
      let hash = Math.imul(2166136261 ^ x, 16777619);
      hash = Math.imul(hash ^ y, 16777619);
      hash = Math.imul(hash ^ z, 16777619);
      hash = Math.imul(hash ^ a, 16777619);
      hash = Math.imul(hash ^ b, 16777619);
      hash = Math.imul(hash ^ c, 16777619);
      hash ^= hash >>> 16;
      let slot = hash & (capacity - 1);
      while ((target = slots[slot]!)) {
        const start = (target - 1) * 3;
        if (
          positionBits[start] === x &&
          positionBits[start + 1] === y &&
          positionBits[start + 2] === z &&
          normals[start] === a &&
          normals[start + 1] === b &&
          normals[start + 2] === c
        )
          break;
        slot = (slot + 1) & (capacity - 1);
      }
      if (!target) {
        target = ++used;
        slots[slot] = target;
        const start = (target - 1) * 3;
        positionBits[start] = x;
        positionBits[start + 1] = y;
        positionBits[start + 2] = z;
        normals[start] = a;
        normals[start + 1] = b;
        normals[start + 2] = c;
      }
      remap[original] = target;
    }
    mapped[i] = target - 1;
  }
  return {
    positions: used === count ? positions : positions.slice(0, used * 3),
    normals: used === count ? normals : normals.slice(0, used * 3),
    indices: used <= 65535 ? new Uint16Array(mapped) : mapped,
  };
}
