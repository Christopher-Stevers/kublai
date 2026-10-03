// Renders a horizontally seamless strip of riveted steel angle with a ForemanHQ blue tinge.
// It trims the joins between the expanded-steel bars and the checker-plate chat.
// Usage: node scripts/render-angle-trim.mjs public/images/chat-angle-trim.webp
import sharp from "sharp";

const OUT = process.argv[2] ?? "angle-trim.webp";
const SS = 3;
const W = 192; // final tile width (px); shown at half size in CSS
const H = 32;
const w = W * SS;
const h = H * SS;
const RIVET_R = 0.2 * h;
const RIVET_Y = 0.42 * h;

const light = [-0.35, -0.75, 0.56];
const ln = Math.hypot(...light);
const [lx, ly, lz] = light.map((c) => c / ln);
const tint = [0.8, 0.9, 1.06];
const brand = [76, 107, 140];

let seed = 5;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
// Brushed streaks along the bar, wrapping horizontally.
const brushed = new Float32Array(w * h);
for (let y = 0; y < h; y++) {
  const row = Array.from({ length: w }, () => rand());
  const r = 30;
  let acc = 0;
  for (let k = -r; k <= r; k++) acc += row[(k + w) % w];
  for (let x = 0; x < w; x++) {
    brushed[y * w + x] = acc / (2 * r + 1) - 0.5;
    acc += row[(x + r + 1) % w] - row[(x - r + w) % w];
  }
}

/** Surface normal (x, y, z) of the angle's visible leg at row t (0 top .. 1 bottom). */
function profileNormal(t) {
  if (t < 0.1) {
    // Top edge, rounded back toward the mesh.
    const a = ((0.1 - t) / 0.1) * (Math.PI / 2.4);
    return [0, -Math.sin(a), Math.cos(a)];
  }
  if (t < 0.7) return [0, 0, 1]; // flat face
  // Rounded heel turning under the bar.
  const a = Math.min(1, (t - 0.7) / 0.3) * (Math.PI / 2);
  return [0, Math.sin(a), Math.cos(a)];
}

const raw = Buffer.alloc(w * h * 3);
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const t = y / (h - 1);
    let [nx, ny, nz] = profileNormal(t);
    // Dome rivet in the middle of each tile.
    const dx = x - w / 2;
    const dy = y - RIVET_Y;
    const r = Math.hypot(dx, dy);
    let rivet = 0;
    if (r < RIVET_R) {
      const q = r / RIVET_R;
      const s = Math.sin(q * (Math.PI / 2.3));
      nx = (dx / (r || 1)) * s;
      ny = (dy / (r || 1)) * s;
      nz = Math.sqrt(Math.max(0, 1 - s * s));
      rivet = 1;
    }
    const diffuse = Math.max(0, nx * lx + ny * ly + nz * lz);
    const hz = lz + 1;
    const hl = Math.hypot(lx, ly, hz);
    const spec = Math.max(0, (nx * lx + ny * ly + nz * hz) / hl) ** 35 * 0.55;
    // A thin dark ring where the rivet head meets the bar.
    const ring = r >= RIVET_R && r < RIVET_R + 1.5 * SS ? 0.55 : 1;
    const streak = rivet ? 0 : brushed[y * w + x] * 0.35;
    const shade = ((0.42 + 0.62 * diffuse) * (1 + streak) + spec) * ring;
    for (let c = 0; c < 3; c++) {
      const metal = shade * 230 * tint[c];
      const v = metal * 0.8 + brand[c] * 0.2 * (shade + 0.2);
      raw[(y * w + x) * 3 + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }

await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
  .resize(W, H, { kernel: "lanczos3" })
  .webp({ quality: 88 })
  .toFile(OUT);
console.log("wrote", OUT);
