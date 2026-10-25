// Renders a seamless aluminium tread (checker) plate tile as stainless steel under low light.
import sharp from "sharp";

const OUT = process.argv[2] ?? "checker-plate.webp";
const SS = 2; // supersampling
const T = 768; // final tile size (px); shown at 384 CSS px
const N = T * SS;
const S = (T / 16) * SS; // lattice spacing: 16 x 16 lozenges per tile
const L = 0.78 * S; // lozenge length
const W = 0.2 * S; // lozenge width

let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

// Brushed metal: per-row noise, blurred along x (wrapping) so streaks run horizontally.
const brushed = new Float32Array(N * N);
for (let y = 0; y < N; y++) {
  const row = Array.from({ length: N }, () => rand());
  const r = 18 * SS;
  let acc = 0;
  for (let k = -r; k <= r; k++) acc += row[(k + N) % N];
  for (let x = 0; x < N; x++) {
    brushed[y * N + x] = acc / (2 * r + 1);
    acc += row[(x + r + 1) % N] - row[(x - r + N) % N];
  }
}
// Normalise streak contrast.
let mean = 0;
for (const v of brushed) mean += v;
mean /= brushed.length;
for (let i = 0; i < brushed.length; i++) brushed[i] = (brushed[i] - mean) * 9 + (rand() - 0.5) * 0.05;

// Wear, so the plate isn't factory perfect. Seamless value noise (period divides N).
function valueNoise(period, amp) {
  const g = Array.from({ length: period * period }, () => rand() * 2 - 1);
  const out = new Float32Array(N * N);
  const cell = N / period;
  const at = (gx, gy) => g[(gy % period) * period + (gx % period)];
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const fx = x / cell, fy = y / cell;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = smooth(fx - x0), ty = smooth(fy - y0);
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
      out[y * N + x] = (a + (b - a) * ty) * amp;
    }
  return out;
}
// Broad mottling and patchy dullness (smudges dim the sheen).
const mottle = valueNoise(3, 0.05);
const mottleFine = valueNoise(11, 0.025);
const smudge = valueNoise(5, 1).map((v) => Math.max(0, v - 0.35) * 1.6);
// Fine scratches: thin wrapped segments, mostly along the grain, a few across.
const scratch = new Float32Array(N * N);
for (let k = 0; k < 200; k++) {
  const along = rand() < 0.75;
  const a = along ? (rand() - 0.5) * 0.25 : rand() * Math.PI;
  const len = (along ? 40 + rand() * 260 : 10 + rand() * 60) * SS;
  const sx = rand() * N, sy = rand() * N;
  const v = (rand() < 0.6 ? 1 : -1) * (0.06 + rand() * 0.1);
  for (let t = 0; t < len; t += 0.5) {
    const fade = Math.sin((Math.PI * t) / len);
    const x = Math.floor((((sx + Math.cos(a) * t) % N) + N) % N);
    const y = Math.floor((((sy + Math.sin(a) * t) % N) + N) % N);
    scratch[y * N + x] = v * fade;
  }
}
// Each lozenge wears a little differently.
const wear = Array.from({ length: (N / S) ** 2 }, () => (rand() - 0.5) * 0.12);
const lozenge = new Int32Array(N * N).fill(-1);

// Height map of the raised lozenges, alternating ±45° in a checkerboard.
const height = new Float32Array(N * N);
const cells = N / S;
for (let gy = 0; gy < cells; gy++)
  for (let gx = 0; gx < cells; gx++) {
    const cx = (gx + 0.5) * S;
    const cy = (gy + 0.5) * S;
    const a = ((gx + gy) % 2 === 0 ? 1 : -1) * (Math.PI / 4);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const R = Math.ceil(L / 2) + 2;
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const u = dx * ca + dy * sa;
        const v = -dx * sa + dy * ca;
        const t = (2 * u) / L;
        if (Math.abs(t) >= 1) continue;
        const half = (W / 2) * (1 - t * t) ** 0.6;
        const q = v / half;
        if (Math.abs(q) >= 1) continue;
        const h = Math.sqrt(1 - q * q) * (1 - t ** 8) ** 0.5;
        const x = (((cx + dx) % N) + N) % N;
        const y = (((cy + dy) % N) + N) % N;
        const i = Math.floor(y) * N + Math.floor(x);
        if (h > height[i]) lozenge[i] = gy * cells + gx;
        height[i] = Math.max(height[i], h);
      }
  }

// Light from the top-left.
const light = [-0.5, -0.6, 0.62];
const ln = Math.hypot(...light);
const [lx, ly, lz] = light.map((c) => c / ln);
// Stainless steel: near-neutral, the faintest cool cast; DIM is the low light.
const tint = [0.97, 0.985, 1.0];
const DIM = 0.76;
const raw = Buffer.alloc(N * N * 3);
const H = 5 * SS; // bump strength
for (let y = 0; y < N; y++)
  for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const hx = height[y * N + ((x + 1) % N)] - height[y * N + ((x - 1 + N) % N)];
    const hy = height[((y + 1) % N) * N + x] - height[((y - 1 + N) % N) * N + x];
    let nx = -hx * H * 0.5;
    let ny = -hy * H * 0.5;
    let nz = 1;
    const nl = Math.hypot(nx, ny, nz);
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const diffuse = Math.max(0, nx * lx + ny * ly + nz * lz);
    // Specular highlight on the bump ridges.
    const hz = lz + 1;
    const hl = Math.hypot(lx, ly, hz);
    const spec = Math.max(0, (nx * lx + ny * ly + nz * hz) / hl) ** 40 * (height[i] > 0 ? 0.35 : 0.08);
    const worn = lozenge[i] >= 0 ? wear[lozenge[i]] * height[i] : 0;
    const base = 0.8 + brushed[i] * 0.06 + height[i] * 0.04 + mottle[i] + mottleFine[i] + worn + scratch[i] * (1 - height[i]);
    const shade = base * (0.55 + 0.6 * diffuse) + spec * (1 - 0.6 * Math.min(1, smudge[i])) - smudge[i] * 0.04;
    for (let c = 0; c < 3; c++) {
      const metal = shade * 255 * tint[c];
      const v = metal * DIM;
      raw[i * 3 + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }

await sharp(raw, { raw: { width: N, height: N, channels: 3 } })
  .resize(T, T, { kernel: "lanczos3" })
  .webp({ quality: 82 })
  .toFile(OUT);
console.log("wrote", OUT);
