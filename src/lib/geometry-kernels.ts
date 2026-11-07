import init, { compact, merge_lines } from "./geometry-wasm/geometry";
import type { SnapSegment } from "./sheet-snap";

let ready = false;
let loading: Promise<boolean> | undefined;
/** Loaded once per worker; failure retains the original TypeScript path. */
export function initializeGeometryKernels() {
  return (loading ??= (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch("/wasm/foreman-geometry-v1.wasm", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Geometry module unavailable");
        await init({ module_or_path: await response.arrayBuffer() });
        ready = true;
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      ready = false;
    }
    return ready;
  })());
}

export function mergeLinesRust(
  segments: SnapSegment[],
  aspect: number,
): SnapSegment[] | null {
  if (!ready || segments.length < 1000 || segments.length > 1_000_000)
    return null;
  try {
    const input = new Float64Array(segments.length * 4);
    segments.forEach((p, i) => input.set([p.x1, p.y1, p.x2, p.y2], i * 4));
    const result = merge_lines(input, aspect);
    const lines: SnapSegment[] = [];
    for (let i = 0; i < result.length; i += 4)
      lines.push({
        x1: result[i]!,
        y1: result[i + 1]!,
        x2: result[i + 2]!,
        y2: result[i + 3]!,
      });
    return lines;
  } catch {
    return null;
  }
}

export function compactGeometryRust(
  vertices: Float32Array,
  indices: Uint32Array,
) {
  if (
    !ready ||
    indices.length < 3000 ||
    vertices.length > 6_000_000 ||
    indices.length > 3_000_000
  )
    return null;
  try {
    const result = compact(vertices, indices);
    try {
      const positions = result.positions(),
        normals = result.normals(),
        mapped = result.indices();
      return {
        positions,
        normals,
        indices:
          positions.length / 3 <= 65535 ? new Uint16Array(mapped) : mapped,
      };
    } finally {
      result.free();
    }
  } catch {
    return null;
  }
}
