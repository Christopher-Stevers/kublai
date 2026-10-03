// Renders the chat notification icons:
//  - notification-icon.png: the large colour icon shown in the notification
//  - notification-badge.png: the small white status-bar icon (Android masks it)
// Usage: node scripts/render-notification-icons.mjs public/foremanhq
import sharp from "sharp";

const dir = process.argv[2] ?? ".";
// A speech bubble with a tail at the lower left (96 x 96 design grid).
const BUBBLE =
  "M20 14h56a12 12 0 0 1 12 12v34a12 12 0 0 1-12 12H40l-18 14v-14h-2A12 12 0 0 1 8 60V26a12 12 0 0 1 12-12z";
// Lucide's wrench, drawn as a stroke on a 24-unit grid.
const WRENCH =
  "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z";
const wrench = (stroke, width) =>
  `<g transform="translate(26 21) scale(1.85)"><path d="${WRENCH}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/></g>`;

const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 96 96">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4f7cae"/>
      <stop offset="1" stop-color="#2b4c74"/>
    </linearGradient>
  </defs>
  <rect width="96" height="96" rx="22" fill="url(#bg)"/>
  <g transform="translate(6 7) scale(0.875)">
    <path d="${BUBBLE}" fill="#fff"/>
    ${wrench("#2f5582", 2.4)}
  </g>
</svg>`;

// Badge: white bubble with the wrench cut out, on transparent.
const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <defs>
    <mask id="cut">
      <rect width="96" height="96" fill="#fff"/>
      ${wrench("#000", 2.6)}
    </mask>
  </defs>
  <path d="${BUBBLE}" fill="#fff" mask="url(#cut)"/>
</svg>`;

await sharp(Buffer.from(icon)).png().toFile(`${dir}/notification-icon.png`);
await sharp(Buffer.from(badge)).png().toFile(`${dir}/notification-badge.png`);
console.log("wrote", `${dir}/notification-icon.png`, `${dir}/notification-badge.png`);
