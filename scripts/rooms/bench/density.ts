/** Multiscale soft wall evidence. No room polygons, labels, or learned weights. */
import type { Mask } from '../../../src/server/rooms/raster-rooms';

/** Clamped-edge box mean, O(width * height) independent of radius. */
export function boxMean(input: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (input.length !== width * height || width < 1 || height < 1 || !Number.isInteger(radius) || radius < 0)
    throw new Error('Invalid density dimensions/radius');
  if (!radius) return new Float32Array(input);
  const tmp = new Float32Array(input.length), out = new Float32Array(input.length);
  const diameter = 2 * radius + 1;
  for (let y = 0; y < height; y++) {
    const offset = y * width;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += input[offset + Math.max(0, Math.min(width - 1, x))]!;
    for (let x = 0; x < width; x++) {
      tmp[offset + x] = sum / diameter;
      sum += input[offset + Math.min(width - 1, x + radius + 1)]! - input[offset + Math.max(0, x - radius)]!;
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.max(0, Math.min(height - 1, y)) * width + x]!;
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / diameter;
      sum += tmp[Math.min(height - 1, y + radius + 1) * width + x]! - tmp[Math.max(0, y - radius) * width + x]!;
    }
  }
  return out;
}

export type DensitySource = 'walls' | 'ink' | 'combined';

/**
 * Fine scale keeps edges; coarse scale allows evidence on either side of a
 * doorway to support a boundary through the gap. Long wall bands dominate
 * combined mode; raw darkness adds angled/thin evidence at lower weight.
 * Costs are dimensionless [0,1]; scale follows drawing resolution.
 */
export function densityBarrier(rgba: Uint8ClampedArray, walls: Mask, radius: number,
  source: DensitySource = 'combined'): Float32Array {
  const { width, height } = walls, n = width * height;
  if (rgba.length !== n * 4 || walls.data.length !== n || radius < 1) throw new Error('Invalid density input');
  const input = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const darkness = 1 - (0.299 * rgba[p]! + 0.587 * rgba[p + 1]! + 0.114 * rgba[p + 2]!) / 255;
    input[i] = source === 'walls' ? walls.data[i]! : source === 'ink' ? darkness :
      Math.max(walls.data[i]!, darkness * 0.25);
  }
  const fine = boxMean(input, width, height, Math.max(1, Math.round(radius / 2)));
  const coarse = boxMean(input, width, height, radius);
  const output = new Float32Array(n);
  for (let i = 0; i < n; i++) output[i] = Math.max(0, Math.min(1, fine[i]! * 0.35 + coarse[i]! * 0.65));
  return output;
}
