// Renders a seamless aluminium tread (checker) plate tile with a ForemanHQ blue tinge.
import sharp from "sharp";

const OUT = process.argv[2] ?? "checker-plate.webp";
const SS = 2; // supersampling
const T = 192; // final tile size (px); shown at 96 CSS px
const N = T * SS;
const S = (T / 4) * SS; // lattice spacing: 4 x 4 lozenges per tile
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
        height[i] = Math.max(height[i], h);
      }
  }

// Light from the top-left.
const light = [-0.5, -0.6, 0.62];
const ln = Math.hypot(...light);
const [lx, ly, lz] = light.map((c) => c / ln);
const tint = [0.8, 0.9, 1.06]; // cool, slightly blue aluminium
const brand = [76, 107, 140]; // ~ oklch(0.5 0.075 250)
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
    const base = 0.8 + brushed[i] * 0.06 + height[i] * 0.04;
    const shade = base * (0.55 + 0.6 * diffuse) + spec;
    for (let c = 0; c < 3; c++) {
      const metal = shade * 255 * tint[c];
      const v = metal * 0.8 + brand[c] * 0.2 * (shade + 0.2);
      raw[i * 3 + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }

await sharp(raw, { raw: { width: N, height: N, channels: 3 } })
  .resize(T, T, { kernel: "lanczos3" })
  .webp({ quality: 82 })
  .toFile(OUT);
console.log("wrote", OUT);
