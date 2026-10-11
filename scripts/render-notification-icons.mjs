// Renders the push notification icons, a single big wrench:
//  - notification-icon-v2.png: the large colour icon shown in the notification
//  - notification-badge-v2.png: the small white status-bar icon (Android masks it)
// Usage: node scripts/render-notification-icons.mjs public/foremanhq
import sharp from "sharp";

const dir = process.argv[2] ?? ".";
// Lucide's wrench outline on a 24-unit grid, filled solid.
const WRENCH =
  "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z";
// Scale the 24-unit wrench to fill `size` units of the 96-unit canvas, centred.
const wrench = (stroke, width, size) => {
  const scale = size / 22;
  const offset = (96 - size) / 2 - 1 * scale;
  return `<g transform="translate(${offset} ${offset}) scale(${scale})"><path d="${WRENCH}" fill="${stroke}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
};

const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 96 96">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4f7cae"/>
      <stop offset="1" stop-color="#2b4c74"/>
    </linearGradient>
  </defs>
  <rect width="96" height="96" rx="22" fill="url(#bg)"/>
  ${wrench("#fff", 0.8, 64)}
</svg>`;

// Badge: a solid white wrench on transparent, as large as the icon allows.
const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  ${wrench("#fff", 0.8, 80)}
</svg>`;

await sharp(Buffer.from(icon)).png().toFile(`${dir}/notification-icon-v2.png`);
await sharp(Buffer.from(badge)).png().toFile(`${dir}/notification-badge-v2.png`);
console.log(
  "wrote",
  `${dir}/notification-icon-v2.png`,
  `${dir}/notification-badge-v2.png`,
);
