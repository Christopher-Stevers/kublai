// Renders a seamless expanded-steel (diamond mesh) tile with a ForemanHQ blue tinge.
// Openings are transparent (with a soft cast shadow) so a background shows through.
// Usage: node scripts/render-expanded-metal.mjs public/images/chat-expanded-metal.webp
import sharp from "sharp";

const OUT = process.argv[2] ?? "expanded-metal.webp";
const SS = 3; // supersampling
const W = 112; // final tile width (px); shown at half size in CSS
const H = 56;
const w = W * SS;
const h = H * SS;
const STRAND = 0.11; // strand half-width, in lattice units

const light = [-0.45, -0.7, 0.55];
const ln = Math.hypot(...light);
const [lx, ly, lz] = light.map((c) => c / ln);
const brand = [76, 107, 140];
const tint = [0.8, 0.9, 1.06];

/** Distance (lattice units) to the nearest strand, and which strand family. */
function strand(x, y) {
  const a = x / w + y / h; // diagonal "\" family
  const b = x / w - y / h; // diagonal "/" family
  const da = Math.abs(a - Math.round(a));
  const db = Math.abs(b - Math.round(b));
  return da < db ? { d: da, family: 0 } : { d: db, family: 1 };
}
function height(x, y) {
  const { d } = strand(x, y);
  if (d >= STRAND) return 0;
  // Flat strand face with a narrow bevel at each edge.
  return Math.min(1, (STRAND - d) / (STRAND * 0.35));
}

const raw = Buffer.alloc(w * h * 4);
// Shadow cast down-right onto whatever is behind the mesh.
const SHADOW_X = 2.2 * SS;
const SHADOW_Y = 3.2 * SS;
let seed = 11;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    let alpha = 255;
    const { d, family } = strand(x, y);
    let rgb;
    if (d < STRAND) {
      const z = height(x, y);
      const hx = height((x + 1) % w, y) - height((x - 1 + w) % w, y);
      const hy = height(x, (y + 1) % h) - height(x, (y - 1 + h) % h);
      let nx = -hx * 0.9;
      let ny = -hy * 0.9;
      let nz = 1;
      const nl = Math.hypot(nx, ny, nz);
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const diffuse = Math.max(0, nx * lx + ny * ly + nz * lz);
      const hz = lz + 1;
      const hl = Math.hypot(lx, ly, hz);
      const spec = Math.max(0, (nx * lx + ny * ly + nz * hz) / hl) ** 30 * 0.45;
      // Expanded metal strands are twisted: the two families catch light differently.
      const facing = family === 0 ? 1.0 : 0.78;
      const shade =
        (0.5 + 0.55 * diffuse) * facing * (0.92 + 0.08 * z) + spec + (rand() - 0.5) * 0.03;
      rgb = tint.map((t, c) => {
        const metal = shade * 225 * t;
        return metal * 0.8 + brand[c] * 0.2 * (shade + 0.2);
      });
    } else {
      // Openings: transparent, except for the strands' soft shadow.
      const behind = strand((x - SHADOW_X + w) % w, (y - SHADOW_Y + h) % h).d;
      const shadow = Math.max(0, Math.min(1, (STRAND + 0.03 - behind) / 0.06));
      rgb = [8, 14, 24];
      alpha = Math.round(255 * 0.5 * shadow);
    }
    for (let c = 0; c < 3; c++) raw[i + c] = Math.max(0, Math.min(255, Math.round(rgb[c])));
    raw[i + 3] = alpha;
  }

await sharp(raw, { raw: { width: w, height: h, channels: 4 } })
  .resize(W, H, { kernel: "lanczos3" })
  .webp({ quality: 88, alphaQuality: 100 })
  .toFile(OUT);
console.log("wrote", OUT);
