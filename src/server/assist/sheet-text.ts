import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { AsyncResultCache } from "./cache";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import {
  getPdfKeyForFloorImage,
  getSourcePageFromFloorImage,
  JOB_ROOM_FILE_PUBLIC_PREFIX,
} from "~/server/rooms/storage";
const execute = promisify(execFile);
const texts = new AsyncResultCache<{ text: string; truncated: boolean }>(32, 30 * 60_000);
export async function readSheetText(floor: {
  imageUrl: string;
  jobId: string;
  pageNumber: number;
}) {
  const prefix = `${JOB_ROOM_FILE_PUBLIC_PREFIX}/${floor.jobId}/`;
  if (!floor.imageUrl.startsWith(prefix))
    throw new Error("Drawing source is unavailable");
  const key = floor.imageUrl.slice(JOB_ROOM_FILE_PUBLIC_PREFIX.length + 1);
  if (
    key
      .split("/")
      .some((part) => !/^[a-zA-Z0-9.-]+$/.test(part) || part === "..")
  )
    throw new Error("Invalid drawing source");
  const pdfKey = getPdfKeyForFloorImage(key, floor.jobId);
  const filename = path.resolve(
    process.cwd(),
    "uploads/job-floor-plans",
    pdfKey,
  );
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filename)) digest.update(chunk);
  const page = getSourcePageFromFloorImage(key) ?? floor.pageNumber;
  return texts.get(`${floor.jobId}:${digest.digest("hex")}:${page}:pdf-text-v1`, async () => {
  const { stdout } = await execute(
    process.execPath,
    [
      "--max-old-space-size=512",
      "--import",
      "tsx",
      path.join(process.cwd(), "src/server/assist/sheet-text-worker.ts"),
      filename,
      String(page),
    ],
    {
      timeout: 30_000,
      maxBuffer: 200_000,
      env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV },
    },
  );
  // PDF.js warnings may precede the final JSON line.
  const line = stdout.trim().split("\n").at(-1);
  return z
    .object({ text: z.string().max(24_000), truncated: z.boolean() })
    .parse(JSON.parse(line || "{}"));
  });
}
