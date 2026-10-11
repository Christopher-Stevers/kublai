import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { detectTaggedRooms } from "../src/server/rooms/tagged/detect-tagged";

const [engine, pdfPath, outputPath, pageArg = "1"] = process.argv.slice(2);
if (!["rust", "typescript"].includes(engine ?? "") || !pdfPath || !outputPath)
  throw new Error(
    "Usage: verify-room-raster-pdf.ts rust|typescript pdf report.json [page]",
  );
process.env.FOREMAN_RASTER_ENGINE =
  engine === "typescript" ? "typescript" : "auto";
let nativeCalls = 0;
const info = console.info;
console.info = (...args) => {
  if (String(args[0]).includes("[room-raster] engine=rust")) nativeCalls++;
  info(...args);
};
const pdf = await readFile(pdfPath);
const start = performance.now();
const result = await detectTaggedRooms(pdf, Number(pageArg));
if (engine === "rust" && nativeCalls !== 2)
  throw new Error("Both native stages must run");
const report = {
  engine,
  page: Number(pageArg),
  inputSha256: createHash("sha256").update(pdf).digest("hex"),
  resultSha256: createHash("sha256")
    .update(JSON.stringify(result))
    .digest("hex"),
  rooms: result.rooms.length,
  ms: performance.now() - start,
  nativeCalls,
  maxRssKiB: process.resourceUsage().maxRSS,
};
await writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
