import test from 'node:test';
import assert from 'node:assert/strict';
import { boxMean, densityBarrier } from './density';

test('rolling blur agrees with direct mean at boundaries and large radii', () => {
  const w = 5, h = 3, data = Float32Array.from({ length: w * h }, (_, i) => (i % 7) / 7);
  for (const r of [0, 1, 3, 8]) {
    const blurred = boxMean(data, w, h, r);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
        sum += data[Math.max(0, Math.min(h - 1, y + dy)) * w + Math.max(0, Math.min(w - 1, x + dx))]!;
      assert.ok(Math.abs(blurred[y * w + x]! - sum / (2 * r + 1) ** 2) < 1e-6);
    }
  }
});

test('density supports small gaps without hard-filling open room space', () => {
  const width = 51, height = 51, n = width * height;
  const data = new Uint8Array(n), rgba = new Uint8ClampedArray(n * 4).fill(255);
  for (let y = 0; y < height; y++) for (let x = 24; x <= 26; x++) {
    if (y >= 23 && y <= 27) continue;
    data[y * width + x] = 1;
    rgba.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  }
  const cost = densityBarrier(rgba, { width, height, data }, 8);
  assert.ok(cost[25 * width + 25]! > 0.05);
  assert.ok(cost[25 * width + 5]! < 0.001);
  assert.ok(cost.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
});

test('raw text is downweighted relative to long wall evidence', () => {
  const width = 9, height = 9, rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  rgba.fill(0, 40 * 4, 40 * 4 + 3);
  const walls = { width, height, data: new Uint8Array(width * height) };
  const combined = densityBarrier(rgba, walls, 2, 'combined');
  const raw = densityBarrier(rgba, walls, 2, 'ink');
  assert.ok(Math.abs(combined[40]! * 4 - raw[40]!) < 1e-6);
});
