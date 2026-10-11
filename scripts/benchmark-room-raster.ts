import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import { inkMask } from "../src/server/rooms/raster-rooms";
import {
  rasterMorphology,
  closeOpenSteps,
} from "../src/server/rooms/raster-native";

const [engine, imagePath, outputPath, repeatsArg = "5"] = process.argv.slice(2);
if (!["rust", "typescript"].includes(engine ?? "") || !imagePath || !outputPath)
  throw new Error(
    "Usage: benchmark-room-raster.ts rust|typescript image output.json [repeats]",
  );
const image = await readFile(imagePath);
const { data, info } = await sharp(image)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const mask = inkMask(data, info.width, info.height, 128);
const radius = Math.max(
  2,
  Math.round(Math.max(info.width, info.height) / 1700),
);
const steps = closeOpenSteps(
  radius,
  Math.max(1, Math.round(Math.max(info.width, info.height) / 2500)),
);
const repeats = Number(repeatsArg);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 20)
  throw new Error("Invalid repeats");
const durations: number[] = [];
let outputSha256 = "";
for (let i = 0; i < repeats + 1; i++) {
  const start = performance.now();
  const result = await rasterMorphology(
    mask,
    steps,
    engine as "rust" | "typescript",
  );
  const ms = performance.now() - start;
  const hash = createHash("sha256").update(result.data).digest("hex");
  if (outputSha256 && outputSha256 !== hash) throw new Error("Unstable output");
  outputSha256 = hash;
  if (i) durations.push(ms);
}
const sorted = [...durations].sort((a, b) => a - b);
const report = {
  engine,
  sourceSha256: createHash("sha256").update(image).digest("hex"),
  width: info.width,
  height: info.height,
  pixels: mask.data.length,
  steps,
  durationsMs: durations,
  medianMs: sorted[Math.floor(sorted.length / 2)],
  outputSha256,
  parentMaxRssKiB: process.resourceUsage().maxRSS,
  node: process.version,
};
await writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
