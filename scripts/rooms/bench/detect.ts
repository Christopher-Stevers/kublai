/** Offline known-seed adapter. Never imports app services, dotenv or database code. */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { axisWallBands, circulationComponents, componentCentroids, doorwayContacts,
  growByDistance, freeComponents, inkMask, sealAxisGaps, union } from '../../../src/server/rooms/raster-rooms';

type Seed = { x: number; y: number; name?: string };
type Config = { name: string; threshold: number; openRadius: number; join: number;
  bandLengthFraction: number; doorFraction: number; gapFactor: number;
  windowFactor: number; envelope: boolean; grow: boolean; maxRoomFactor: number;
  maxUnlabelledFraction: number; nudgeFraction: number };
const requestPath = process.argv[2];
if (!requestPath) throw new Error('Expected request JSON path');
const request = JSON.parse(await readFile(requestPath, 'utf8')) as {
  image: string; seeds: Seed[]; config: Config; width: number; output: string;
};
const { config: c, seeds } = request;
const start = performance.now();
const input = await loadImage(request.image);
const W = request.width, H = Math.max(1, Math.round(input.height * W / input.width));
const canvas = createCanvas(W, H), ctx = canvas.getContext('2d');
ctx.fillStyle = 'white'; ctx.fillRect(0, 0, W, H); ctx.drawImage(input, 0, 0, W, H);
const t0 = performance.now();
const ink = inkMask(ctx.getImageData(0, 0, W, H).data, W, H, c.threshold);
const length = Math.max(1, Math.round(W * c.bandLengthFraction));
const walls = union(axisWallBands(ink, true, c.join, c.openRadius, length),
  axisWallBands(ink, false, c.join, c.openRadius, length));
const door = c.doorFraction * Math.max(W, H);
const thickness = Math.max(3, Math.round(door / 5)), minRun = thickness * 2;
const working = { width: W, height: H, data: new Uint8Array(walls.data) };
if (c.envelope) {
  const wideGap = Math.round(door * c.windowFactor);
  const outside = freeComponents(union(sealAxisGaps(walls, wideGap, minRun, true),
    sealAxisGaps(walls, wideGap, minRun, false)));
  for (let i = 0; i < W * H; i++) {
    const component = outside.labels[i]!;
    if (component && outside.touchesBorder[component]) working.data[i] = 1;
  }
}
const gap = Math.round(door * c.gapFactor);
const sealedH = sealAxisGaps(working, gap, minRun, true);
const sealedV = sealAxisGaps(working, gap, minRun, false);
const comps = freeComponents(union(sealedH, sealedV));
const owner = new Map<number, number>();
let onWall = 0, outside = 0, shared = 0;
const nudge = (s: Seed) => {
  const cx = Math.round(s.x * (W - 1)), cy = Math.round(s.y * (H - 1));
  const reach = Math.round(W * c.nudgeFraction);
  for (let d = 0; d <= reach; d++) for (let dy = -d; dy <= d; dy++) {
    for (const dx of [-d + Math.abs(dy), d - Math.abs(dy)]) {
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && y >= 0 && x < W && y < H && comps.labels[y * W + x]) return comps.labels[y * W + x]!;
    }
  }
  return 0;
};
for (const s of seeds) {
  const id = nudge(s);
  if (!id) { onWall++; continue; }
  if (comps.touchesBorder[id]) { outside++; continue; }
  if (owner.has(id)) { shared++; continue; }
  owner.set(id, owner.size + 1);
}
let grown = new Int32Array(comps.sizes.length);
if (c.grow) {
  const contacts = new Map<string, number>();
  for (const [mask, horizontal] of [[sealedH, true], [sealedV, false]] as const)
    for (const [key, n] of doorwayContacts(comps.labels, working, mask, horizontal, thickness * 3))
      contacts.set(key, (contacts.get(key) ?? 0) + n);
  const coreSizes = [...owner.keys()].map(k => comps.sizes[k]!).sort((a, b) => a - b);
  const median = coreSizes[Math.floor(coreSizes.length / 2)] ?? 0;
  const circulation = circulationComponents(comps.labels, W, comps.sizes.length - 1, owner, contacts, thickness * 2);
  grown = growByDistance(comps.sizes, componentCentroids(comps.labels, W, comps.sizes.length - 1),
    owner, contacts, id => !!comps.touchesBorder[id] || comps.sizes[id]! > W * H * c.maxUnlabelledFraction || circulation.has(id),
    thickness * 2, median * c.maxRoomFactor);
} else for (const [component, room] of owner) grown[component] = room;
const output = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) output.writeUInt32LE(Math.max(0, grown[comps.labels[i]!] ?? 0), i * 4);
await writeFile(request.output, output);
console.log(JSON.stringify({ width: W, height: H, seeds: seeds.length, rooms: owner.size,
  onWall, outside, shared, detect_ms: performance.now() - t0, adapter_ms: performance.now() - start,
  peak_rss_kb: process.resourceUsage().maxRSS }));
