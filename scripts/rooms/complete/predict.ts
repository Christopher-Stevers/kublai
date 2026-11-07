/** Offline adapter: only image and optional supplied text-label locations enter detection. */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFile, writeFile } from "node:fs/promises";
import { detectAllSpaces } from "../../../src/server/rooms/hybrid/all-spaces";
import { detectHybridRooms } from "../../../src/server/rooms/hybrid/detect-hybrid";
const input = JSON.parse(await readFile(process.argv[2]!, "utf8")) as {
  image: string;
  output: string;
  mode: string;
  seeds: Array<{ x: number; y: number; name: string }>;
};
const image = await loadImage(input.image),
  canvas = createCanvas(image.width, image.height),
  ctx = canvas.getContext("2d");
ctx.drawImage(image, 0, 0);
const rgba = ctx.getImageData(0, 0, image.width, image.height).data;
const start = performance.now();
const result =
  input.mode === "baseline"
    ? detectHybridRooms(rgba, image.width, image.height, input.seeds)
    : detectAllSpaces(rgba, image.width, image.height, input.seeds);
await writeFile(input.output, Buffer.from(result.labels.buffer));
console.log(
  JSON.stringify({
    width: image.width,
    height: image.height,
    ms: performance.now() - start,
    rssMiB: process.resourceUsage().maxRSS / 1024,
  }),
);
