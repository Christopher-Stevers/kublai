/** Offline replay of the production detector; no database, provider, or app writes. */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import {
  ALL_SPACES_VERSION,
  detectAllSpaces,
} from "../../../src/server/rooms/hybrid/all-spaces";
import { renderPdfPageWithoutText } from "../../../src/server/rooms/hybrid/render-page";
import { physicalRoomSeeds } from "../../../src/server/rooms/physical-labels";
import {
  extractPdfLabels,
  extractPdfRoomSeeds,
} from "../../../src/server/rooms/pdf-walls";

type Request = {
  mode: "production" | "preview";
  input: string;
  output: string;
  pageNumber?: number;
};

const request = JSON.parse(await readFile(process.argv[2]!, "utf8")) as Request;
if (!request.input || !request.output)
  throw new Error("A local input and new output path are required");
const started = performance.now();
let page: { rgba: Uint8ClampedArray; width: number; height: number };
let seeds: Array<{ x: number; y: number; name: string }> = [];
if (request.mode === "production") {
  if (!Number.isInteger(request.pageNumber) || request.pageNumber! < 1)
    throw new Error("Production replay requires the exact source PDF page");
  const pdf = await readFile(request.input);
  seeds = physicalRoomSeeds(
    extractPdfRoomSeeds(await extractPdfLabels(pdf, request.pageNumber!)),
  );
  // Keep this value aligned with detect-job.ts; both files are hashed by evaluation.
  page = await renderPdfPageWithoutText(pdf, request.pageNumber!, 5000);
} else if (request.mode === "preview") {
  const image = await loadImage(request.input);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  page = {
    rgba: context.getImageData(0, 0, image.width, image.height).data,
    width: image.width,
    height: image.height,
  };
} else {
  throw new Error("Expected production or preview input mode");
}
const preparationMs = performance.now() - started;
const result = detectAllSpaces(page.rgba, page.width, page.height, seeds);
const diagnostic = {
  nodeVersion: process.version,
  version: ALL_SPACES_VERSION,
  mode: request.mode,
  width: page.width,
  height: page.height,
  extractedSeeds: seeds.length,
  preparationMs,
  detectorMs: performance.now() - started - preparationMs,
  totalMs: performance.now() - started,
  rssMiB: process.resourceUsage().maxRSS / 1024,
};
await writeFile(
  request.output,
  JSON.stringify({ rooms: result.rooms, diagnostic }),
  { mode: 0o600, flag: "wx" },
);
console.log(JSON.stringify(diagnostic));
