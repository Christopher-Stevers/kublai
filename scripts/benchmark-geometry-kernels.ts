import { readFileSync } from "node:fs";
import { initSync } from "../src/lib/geometry-wasm/geometry.js";
import {
  initializeGeometryKernels,
  compactGeometryRust,
  mergeLinesRust,
} from "../src/lib/geometry-kernels";
import { compactGeometryTypeScript } from "../src/lib/bim/compact-geometry";
import { mergeCollinear } from "../src/lib/sheet-snap";
import { freeComponents } from "../src/server/rooms/raster-rooms";
import { freeComponentsNative } from "../src/server/rooms/components-native";
const bytes = readFileSync("public/wasm/foreman-geometry-v1.wasm");
const start = performance.now();
initSync({ module: bytes });
const init = performance.now() - start;
globalThis.fetch = async () => new Response(bytes);
await initializeGeometryKernels();
async function bench(name: string, old: () => unknown, next: () => unknown) {
  const times: number[][] = [[], []];
  for (let i = 0; i < 9; i++) {
    for (const [j, fn] of [old, next].entries()) {
      const s = performance.now();
      await fn();
      if (i > 1) times[j]!.push(performance.now() - s);
    }
  }
  const med = times.map((t) => t.sort((a, b) => a - b)[3]);
  console.log(JSON.stringify({ name, typescriptMs: med[0], rustMs: med[1] }));
}
const lines = Array.from({ length: 80000 }, (_, i) => ({
  x1: (i % 100) * 0.009,
  y1: Math.floor(i / 100) * 0.001,
  x2: (i % 100) * 0.009 + 0.005,
  y2: Math.floor(i / 100) * 0.001,
}));
await bench(
  "80000 drawing dashes",
  () => mergeCollinear(lines, 1.3),
  () => mergeLinesRust(lines, 1.3),
);
for (const n of [3000, 30000, 300000]) {
  const v = new Float32Array(n * 6),
    idx = Uint32Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < n; i++)
    v.set([i % 500, Math.floor(i / 500), i % 7, 0, 0, 1], i * 6);
  await bench(
    `${n} model vertices`,
    () => compactGeometryTypeScript(v, idx),
    () => compactGeometryRust(v, idx),
  );
}
for (const width of [512, 2048]) {
  const mask = {
    width,
    height: width,
    data: Uint8Array.from({ length: width * width }, (_, i) =>
      Number((i % width) % 101 === 0 || Math.floor(i / width) % 97 === 0),
    ),
  };
  await bench(
    `${width} square room mask`,
    () => freeComponents(mask),
    () => freeComponentsNative(mask, "rust"),
  );
}
console.log(JSON.stringify({ wasmBytes: bytes.length, initMs: init }));
