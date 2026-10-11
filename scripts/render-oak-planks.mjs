// Renders the dark oak plank texture behind the slide-out chat panel.
// Planks run horizontally; the image repeats vertically on a plank seam.
// Usage: node scripts/render-oak-planks.mjs public/images
import sharp from "sharp";

const dir = process.argv[2] ?? ".";
const WIDTH = 640;
const PLANK = 96; // 60 CSS px at the 1.6x the image is drawn at
const COUNT = 10;
const HEIGHT = PLANK * COUNT;
// Deterministic pseudo-random numbers so the texture renders the same each time.
let state = 7;
const random = () => (state = (state * 16807) % 2147483647) / 2147483647;
const tones = ["#2e1d0f", "#34210f", "#291a0c", "#382412", "#30200f"];

let filters = "";
let planks = "";
for (let i = 0; i < COUNT; i++) {
  const y = i * PLANK;
  const tone = tones[Math.floor(random() * tones.length)];
  filters += `
  <filter id="grain${i}" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.0035 0.11" numOctaves="4" seed="${i * 13 + 5}"/>
    <feColorMatrix values="0 0 0 0 0.09  0 0 0 0 0.05  0 0 0 0 0.02  1.9 0 0 0 -0.72"/>
  </filter>
  <filter id="lines${i}" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.006 0.42" numOctaves="3" seed="${i * 11 + 9}"/>
    <feColorMatrix values="0 0 0 0 0.05  0 0 0 0 0.025  0 0 0 0 0.01  2.6 0 0 0 -1.15"/>
  </filter>
  <filter id="sheen${i}" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.002 0.045" numOctaves="2" seed="${i * 7 + 2}"/>
    <feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.32  0 0 0 0 0.17  1.2 0 0 0 -0.55"/>
  </filter>`;
  // Butt joints: where one board ends and the next begins along the row.
  const joint = 120 + random() * 400;
  planks += `
  <g>
    <rect x="0" y="${y}" width="${WIDTH}" height="${PLANK}" fill="${tone}"/>
    <rect x="0" y="${y}" width="${WIDTH}" height="${PLANK}" filter="url(#sheen${i})"/>
    <rect x="0" y="${y}" width="${WIDTH}" height="${PLANK}" filter="url(#grain${i})"/>
    <rect x="0" y="${y}" width="${WIDTH}" height="${PLANK}" filter="url(#lines${i})"/>
    <rect x="${joint}" y="${y}" width="3" height="${PLANK}" fill="#140b04" opacity="0.85"/>
    <rect x="${joint + 3}" y="${y}" width="1.5" height="${PLANK}" fill="#7a5634" opacity="0.35"/>
    <rect x="0" y="${y}" width="${WIDTH}" height="1.5" fill="#8a6440" opacity="0.28"/>
    <rect x="0" y="${y + PLANK - 3}" width="${WIDTH}" height="3" fill="#120a04" opacity="0.9"/>
  </g>`;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>${filters}
  </defs>${planks}
</svg>`;

await sharp(Buffer.from(svg))
  .webp({ quality: 72 })
  .toFile(`${dir}/chat-oak-planks.webp`);
console.log("wrote", `${dir}/chat-oak-planks.webp`);
