import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import {
  openSpaceMask,
  paintMask,
  keepDoubleLineWalls,
} from "../src/server/rooms/tagged/wall-weights";

const [engine, imagePath, outputPath, repeatsArg = "3"] = process.argv.slice(2);
if (!["rust", "typescript"].includes(engine ?? "") || !imagePath || !outputPath)
  throw new Error(
    "Usage: benchmark-room-wall-preparation.ts rust|typescript image output.json [repeats]",
  );
process.env.FOREMAN_RASTER_ENGINE =
  engine === "typescript" ? "typescript" : "auto";
const image = await readFile(imagePath);
const { data, info } = await sharp(image)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
// Geometry equivalence does not require label text; fixed seeds exercise the
// same outdoor-region selection in both versions, without a room answer key.
const seeds = [
  { x: 0.25, y: 0.25 },
  { x: 0.5, y: 0.5 },
  { x: 0.75, y: 0.75 },
];
let fallback = false;
const originalWarn = console.warn;
console.warn = (...args) => {
  fallback = true;
  originalWarn(...args);
};
const durations: number[] = [];
const repeats = Number(repeatsArg);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 20)
  throw new Error("Invalid repeats");
let outputSha256 = "";
for (let i = 0; i < repeats + 1; i++) {
  const rgba = new Uint8ClampedArray(data);
  const start = performance.now();
  const outdoor = await openSpaceMask(rgba, info.width, info.height, seeds);
  paintMask(rgba, outdoor.mask);
  await keepDoubleLineWalls(rgba, info.width, info.height);
  const ms = performance.now() - start;
  const hash = createHash("sha256")
    .update(rgba)
    .update(outdoor.mask.data)
    .update(
      JSON.stringify([outdoor.regions, outdoor.medianRoomPx, outdoor.limitPx]),
    )
    .digest("hex");
  if (outputSha256 && outputSha256 !== hash) throw new Error("Unstable output");
  outputSha256 = hash;
  if (i) durations.push(ms);
}
if (engine === "rust" && fallback) throw new Error("Native engine did not run");
const sorted = [...durations].sort((a, b) => a - b);
const report = {
  engine,
  sourceSha256: createHash("sha256").update(image).digest("hex"),
  width: info.width,
  height: info.height,
  durationsMs: durations,
  medianMs: sorted[Math.floor(sorted.length / 2)],
  outputSha256,
  parentMaxRssKiB: process.resourceUsage().maxRSS,
  node: process.version,
};
await writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
