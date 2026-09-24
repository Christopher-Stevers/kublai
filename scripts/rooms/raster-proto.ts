// Dev tool: raster room detection prototype on one floor.
//   node --import dotenv/config --import tsx --import ./scripts/bench/register-stubs.mjs \
//     scripts/rooms/raster-proto.ts <floor> [longSidePx] [crop x0,y0,x1,y1] [openR] [inkThreshold]
import { createCanvas } from "@napi-rs/canvas";
import { writeFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { sql } from "drizzle-orm";

import { db } from "~/server/db";
import { extractPdfLabels, extractPdfLinework, extractPdfRoomSeeds } from "~/server/rooms/pdf-walls";
import { getPdfKeyForFloorImage, getSourcePageFromFloorImage, readJobRoomFile } from "~/server/rooms/storage";
import { typicalDoorWidth, axisWallBands, circulationComponents, componentCentroids, doorwayContacts, growByDistance, freeComponents, inkMask, open, sealAxisGaps, typicalBandThickness, union } from "~/server/rooms/raster-rooms";

const [name = "S302b", pxArg = "6000", cropArg = "", rArg = "", thrArg = "245", cArg = "3"] = process.argv.slice(2);
const [floor] = await db.execute<any>(sql`select * from kublai_job_floor where name=${name} limit 1`);
const storageKey = floor.imageUrl.split("/files/")[1];
const pdf = await readJobRoomFile(getPdfKeyForFloorImage(storageKey, floor.jobId));
const pageNumber = getSourcePageFromFloorImage(storageKey) ?? floor.pageNumber;
const labels = await extractPdfLabels(pdf, pageNumber);
const seeds = extractPdfRoomSeeds(labels);
const linework = await extractPdfLinework(pdf, pageNumber);

const t0 = Date.now();
const doc = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
const page = await doc.getPage(pageNumber);
const base = page.getViewport({ scale: 1 });
const viewport = page.getViewport({ scale: Number(pxArg) / Math.max(base.width, base.height) });
const W = Math.round(viewport.width), H = Math.round(viewport.height);
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "white"; ctx.fillRect(0, 0, W, H);
// Skip text: labels come from the text layer, and glyphs are not walls.
const noText = new Proxy(ctx as any, {
  get(target, prop) {
    if (prop === "fillText" || prop === "strokeText") return () => undefined;
    const value = target[prop];
    return typeof value === "function" ? value.bind(target) : value;
  },
  set(target, prop, value) { target[prop] = value; return true; },
});
await page.render({ canvasContext: noText, viewport, canvas: canvas as any }).promise;
const rgba = ctx.getImageData(0, 0, W, H).data;
const t1 = Date.now();

const ink = inkMask(rgba, W, H, Number(thrArg));
// Pick the opening radius from the data: walls are the thickest common bands.
const r = rArg ? Number(rArg) : Math.max(1, Math.round(W / 3000));
const join = Number(cArg);
const bandLength = Math.round(W / 600); // ≈ 2·len+1 px minimum wall run
const walls = union(
  axisWallBands(ink, true, join, r, bandLength),
  axisWallBands(ink, false, join, r, bandLength),
);
const aspect = (linework.pageWidth ?? W) / (linework.pageHeight ?? H);
void typicalDoorWidth; void aspect;
// Door width as a fraction of the sheet's long side (≈0.9 m at 1:100 on these sheets).
const doorPx = Number(process.env.DOOR_FRACTION ?? 0.0095) * Math.max(W, H);
const door = null;
// Scale everything from the door width: walls are ~1/5 of a door.
const thickness = Math.max(3, Math.round(doorPx / 5));
const maxGap = Math.round(doorPx * Number(process.env.GAP_FACTOR ?? 1.15));
const minRun = Math.round(thickness * 2);
console.log(`door width ≈ ${doorPx.toFixed(0)}px (${door ? "from swings" : "fallback"})`);
// Envelope pass: wide seals close windows; whatever is still connected to
// the page border is outdoors and becomes solid for the door-width pass.
const wideGap = Math.round(doorPx * Number(process.env.WINDOW_FACTOR ?? 3.5));
const envelope = freeComponents(union(sealAxisGaps(walls, wideGap, minRun, true), sealAxisGaps(walls, wideGap, minRun, false)));
const withOutside = { width: W, height: H, data: new Uint8Array(walls.data) };
for (let i = 0; i < W * H; i += 1) {
  const c = envelope.labels[i]!;
  if (c && envelope.touchesBorder[c]) withOutside.data[i] = 1;
}
const sealedH = sealAxisGaps(withOutside, maxGap, minRun, true);
const sealedV = sealAxisGaps(withOutside, maxGap, minRun, false);
const sealed = union(sealedH, sealedV);
const comps = freeComponents(sealed);
const reach = thickness * 3;
const contacts = new Map<string, number>();
for (const [m, horizontal] of [[sealedH, true], [sealedV, false]] as const)
  for (const [k, v] of doorwayContacts(comps.labels, withOutside, m, horizontal, reach)) contacts.set(k, (contacts.get(k) ?? 0) + v);
const t2 = Date.now();

// Assign seeds to components.
const px = (s: { x: number; y: number }) => Math.round(s.y * H) * W + Math.round(s.x * W);
const owner = new Map<number, string[]>();
let hits = 0, outside = 0, onWall = 0;
// Labels often sit on their own tag box: use the nearest free pixel nearby.
const nudge = (s: { x: number; y: number }) => {
  const cx = Math.round(s.x * W), cy = Math.round(s.y * H);
  const reach = Math.round(W / 250);
  for (let d = 0; d <= reach; d += 1)
    for (let dy = -d; dy <= d; dy += 1)
      for (const dx of [-d + Math.abs(dy), d - Math.abs(dy)]) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const c = comps.labels[y * W + x]!;
        if (c) return c;
      }
  return 0;
};
for (const s of seeds) {
  const c = nudge(s);
  if (!c) { onWall += 1; continue; }
  if (comps.touchesBorder[c]) { outside += 1; continue; }
  hits += 1;
  owner.set(c, [...(owner.get(c) ?? []), s.name]);
}
const shared = [...owner.values()].filter((names) => names.length > 1).length;
// Grow each labelled component through doorways into unlabelled space.
const roomOf = new Map<number, number>([...owner.keys()].map((c, i) => [c, i + 1]));
const maxRoomPx = W * H * 0.01;
// Suites should not exceed a few times the typical labelled core.
const coreSizes = [...roomOf.keys()].map((c) => comps.sizes[c]!).sort((a, b) => a - b);
const medianCore = coreSizes[Math.floor(coreSizes.length / 2)] ?? 0;
const circulation = circulationComponents(comps.labels, W, comps.sizes.length - 1, roomOf, contacts, Math.round(thickness * 2));
console.log(`circulation components: ${circulation.size}`);
const grown = growByDistance(
  comps.sizes,
  componentCentroids(comps.labels, W, comps.sizes.length - 1),
  roomOf,
  contacts,
  (c) => comps.touchesBorder[c]! || comps.sizes[c]! > maxRoomPx || circulation.has(c),
  Math.round(thickness * 2),
  medianCore * Number(process.env.MAX_ROOM_FACTOR ?? 4),
);
const absorbed = [...grown].filter((o, c) => o > 0 && !roomOf.has(c)).length;
console.log(`doorway pairs=${contacts.size}; absorbed ${absorbed} unlabelled spaces into labelled rooms; shared=${[...grown].filter((o) => o === -1).length}`);
console.log(`${name}: ${W}x${H} render ${t1 - t0}ms, detect ${t2 - t1}ms; r=${r} bandThickness=${thickness}px maxGap=${maxGap}px`);
console.log(`seeds=${seeds.length} inRoom=${hits} (components=${owner.size}, shared by >1 label=${shared}) onWall=${onWall} leakedOutside=${outside}`);
for (const [c, names] of owner) if (names.length > 1) console.log("  shared:", names.join(", "));

// Overlay: page faint, walls dark, sealed gaps red, seeded components colored.
const img = ctx.getImageData(0, 0, W, H);
const d = img.data;
const colors = new Map<number, [number, number, number]>();
let hue = 0;
for (const c of roomOf.values()) {
  hue = (hue + 137.5) % 360;
  const h = hue / 60, x = 1 - Math.abs((h % 2) - 1);
  const [r1, g1, b1] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
  colors.set(c, [r1 * 255, g1 * 255, b1 * 255]);
}
for (let i = 0; i < W * H; i += 1) {
  const p = i * 4;
  if (walls.data[i]) { d[p] = 40; d[p + 1] = 40; d[p + 2] = 40; continue; }
  if (sealed.data[i]) { d[p] = 230; d[p + 1] = 0; d[p + 2] = 0; continue; }
  const color = colors.get(grown[comps.labels[i]!]!);
  const fade = (v: number) => 255 - (255 - v) * 0.35;
  if (color) {
    d[p] = (fade(d[p]!) + color[0]) / 2; d[p + 1] = (fade(d[p + 1]!) + color[1]) / 2; d[p + 2] = (fade(d[p + 2]!) + color[2]) / 2;
  } else { d[p] = fade(d[p]!); d[p + 1] = fade(d[p + 1]!); d[p + 2] = fade(d[p + 2]!); }
}
ctx.putImageData(img, 0, 0);
ctx.font = `bold ${Math.round(W / 250)}px sans-serif`; ctx.fillStyle = "black";
for (const s of seeds) ctx.fillText(s.name, s.x * W, s.y * H);

const save = async (file: string, crop?: string) => {
  let out = canvas;
  if (crop) {
    const [x0, y0, x1, y1] = crop.split(",").map(Number) as [number, number, number, number];
    out = createCanvas(Math.round((x1 - x0) * W), Math.round((y1 - y0) * H));
    out.getContext("2d").drawImage(canvas as any, -x0 * W, -y0 * H);
  } else {
    out = createCanvas(2400, Math.round((2400 * H) / W));
    out.getContext("2d").drawImage(canvas as any, 0, 0, out.width, out.height);
  }
  await writeFile(file, out.toBuffer("image/png"));
};
await save(`.tmp/raster-${name}.png`);
if (cropArg) await save(`.tmp/raster-${name}-crop.png`, cropArg);
process.exit(0);
