/** Offline known-seed adapter. Never imports app services, dotenv or database code. */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { densityBarrier } from './density';
import type { DensitySource } from './density';
import { partitionRegion } from './seeded-partition';
import { summarizePartitions } from './partition-diagnostics';
import { refineByNarrowCut } from './rectilinear-cut';
import { axisWallBands, circulationComponents, componentCentroids, doorwayContacts,
  growByDistance, freeComponents, inkMask, sealAxisGaps, union } from '../../../src/server/rooms/raster-rooms';

type Seed = { x: number; y: number; name?: string };
type Config = { name: string; threshold: number; openRadius: number; join: number;
  bandLengthFraction: number; doorFraction: number; gapFactor: number;
  windowFactor: number; envelope: boolean; grow: boolean; maxRoomFactor: number;
  maxUnlabelledFraction: number; nudgeFraction: number;
  partition?: 'none' | 'geodesic' | 'watershed'; densitySource?: DensitySource;
  densityRadiusFraction?: number; densityPenalty?: number; rectilinearCut?: boolean };
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
const rgba = ctx.getImageData(0, 0, W, H).data;
const ink = inkMask(rgba, W, H, c.threshold);
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
const located: { seedIndex: number; index: number; label: number; component: number; nudgeDistance: number }[] = [];
const rejectedSeeds: { seedIndex: number; reason: string }[] = [];
let onWall = 0, outside = 0, shared = 0;
const nudge = (s: Seed) => {
  const cx = Math.round(s.x * (W - 1)), cy = Math.round(s.y * (H - 1));
  const reach = Math.round(W * c.nudgeFraction);
  for (let d = 0; d <= reach; d++) for (let dy = -d; dy <= d; dy++) {
    for (const dx of [-d + Math.abs(dy), d - Math.abs(dy)]) {
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && y >= 0 && x < W && y < H && comps.labels[y * W + x]) return y * W + x;
    }
  }
  return -1;
};
for (const [seedIndex, s] of seeds.entries()) {
  const index = nudge(s);
  const id = index < 0 ? 0 : comps.labels[index]!;
  if (!id) { onWall++; rejectedSeeds.push({ seedIndex, reason: 'on-wall' }); continue; }
  if (comps.touchesBorder[id]) { outside++; rejectedSeeds.push({ seedIndex, reason: 'outside' }); continue; }
  const label = seedIndex + 1;
  const nudgeDistance = Math.abs(index % W - Math.round(s.x * (W - 1))) + Math.abs(Math.floor(index / W) - Math.round(s.y * (H - 1)));
  located.push({ seedIndex, index, label, component: id, nudgeDistance });
  if (owner.has(id)) { shared++; continue; }
  owner.set(id, label);
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
let labels: Int32Array = new Int32Array(W * H);
for (let i = 0; i < labels.length; i++) labels[i] = Math.max(0, grown[comps.labels[i]!] ?? 0);
let partitionedComponents = 0, unassignedAnnexComponents = 0;
let cost: Float32Array = new Float32Array(W * H);
if (c.partition && c.partition !== 'none' && shared) {
  const counts = new Map<number, number>();
  for (const seed of located) counts.set(seed.component, (counts.get(seed.component) ?? 0) + 1);
  const sharedIds = new Set([...counts].filter(([, n]) => n > 1).map(([id]) => id));
  partitionedComponents = sharedIds.size;
  // Growth was decided before separate room ownership existed. Do not silently
  // give all annexes of a contested core to its first label. Leave those small
  // unlabelled components for review until a doorway-aware reassignment exists.
  const contestedOwners = new Set([...sharedIds].map(id => owner.get(id)!));
  const annexes = new Set<number>();
  for (let id = 1; id < grown.length; id++)
    if (contestedOwners.has(grown[id]!) && !owner.has(id)) annexes.add(id);
  unassignedAnnexComponents = annexes.size;
  for (let i = 0; i < labels.length; i++) if (annexes.has(comps.labels[i]!)) labels[i] = 0;
  const regions = new Int32Array(W * H);
  for (let i = 0; i < regions.length; i++) if (sharedIds.has(comps.labels[i]!)) regions[i] = comps.labels[i]!;
  cost = densityBarrier(rgba, walls, Math.max(1, Math.round(Math.max(W, H) * (c.densityRadiusFraction ?? 0.025))), c.densitySource ?? 'combined');
  const partition = partitionRegion({ width: W, height: H, regions, cost,
    seeds: located.filter(s => sharedIds.has(s.component)), mode: c.partition, penalty: c.densityPenalty ?? 80 });
  for (let i = 0; i < labels.length; i++) if (partition[i]) labels[i] = partition[i]!;
}
const refined = c.rectilinearCut ? refineByNarrowCut({ width: W, height: H, regions: comps.labels, labels, seeds: located }) : undefined;
if (refined) labels = refined.labels;
const review = summarizePartitions({ width: W, height: H, labels, regions: comps.labels, cost, seeds: located });
const output = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) output.writeUInt32LE(labels[i]!, i * 4);
await writeFile(request.output, output);
console.log(JSON.stringify({ width: W, height: H, seeds: seeds.length, rooms: new Set(labels.filter(n => n > 0)).size, partitionedComponents,
  onWall, outside, shared, unassignedAnnexComponents, rejectedSeeds, review, cuts: refined?.cuts ?? [], detect_ms: performance.now() - t0, adapter_ms: performance.now() - start,
  peak_rss_kb: process.resourceUsage().maxRSS }));
