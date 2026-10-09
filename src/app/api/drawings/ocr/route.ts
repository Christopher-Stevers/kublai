import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { z } from "zod";
import { db } from "~/server/db";
import { jobDrawingSheets } from "~/server/db/schema";
import { userCan } from "~/server/auth/permissions";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { openJobRoomFile } from "~/server/rooms/storage";
import {
  drawingOcrWords,
  MAX_DRAWING_OCR_FILE_BYTES,
  MAX_DRAWING_OCR_PIXELS,
} from "~/server/drawings/ocr";
import { readBoundedBody, assertSameOrigin } from "~/server/documents/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const execute = promisify(execFile);
let active = 0;
const schema = z.object({
  sheetId: z.string().uuid(),
  region: z
    .object({
      left: z.number().min(0).max(0.99),
      top: z.number().min(0).max(0.99),
      width: z.number().min(0.01).max(1),
      height: z.number().min(0.01).max(1),
    })
    .refine((r) => r.left + r.width <= 1.001 && r.top + r.height <= 1.001)
    .optional(),
});
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

/** Explicit, bounded OCR of a stored sheet. No client URLs or shell expressions. */
export async function POST(request: Request) {
  const { user } = await getRequestIdentity(request.headers, {
    request,
    allowDev: true,
  });
  if (
    !user?.organizationId ||
    user.organizationAccessStatus !== "approved" ||
    !userCan(user, "tab.dashboard")
  )
    return reply({ error: "Sign in to this job." }, 403);
  if (Number(request.headers.get("content-length")) > 4096)
    return reply({ error: "Request too large." }, 413);
  let input: z.infer<typeof schema>;
  try {
    assertSameOrigin(request);
    input = schema.parse(
      JSON.parse((await readBoundedBody(request, 4096)).toString("utf8")),
    );
  } catch {
    return reply({ error: "Choose a valid drawing region." }, 400);
  }
  const [sheet] = await db
    .select({
      imageUrl: jobDrawingSheets.imageUrl,
      jobId: jobDrawingSheets.jobId,
    })
    .from(jobDrawingSheets)
    .where(
      and(
        eq(jobDrawingSheets.id, input.sheetId),
        eq(jobDrawingSheets.organizationId, user.organizationId),
      ),
    )
    .limit(1);
  if (!sheet) return reply({ error: "Drawing not found." }, 404);
  if (active >= 2)
    return reply(
      { error: "Text recognition is busy. Try again shortly." },
      429,
    );
  active++;
  let directory: string | undefined;
  try {
    const prefix = `/api/job-rooms/files/${sheet.jobId}/`;
    if (!sheet.imageUrl.startsWith(prefix))
      throw Error("Invalid drawing source");
    const key = sheet.imageUrl.slice("/api/job-rooms/files/".length);
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/floor-\d+\.webp$/i.test(key))
      throw Error("Invalid drawing source");
    const file = await openJobRoomFile(key);
    if (file.size > MAX_DRAWING_OCR_FILE_BYTES) {
      await file.close();
      throw Error("Drawing image is too large");
    }
    const bytes = Buffer.from(await new Response(file.stream()).arrayBuffer());
    const metadata = await sharp(bytes, {
      limitInputPixels: MAX_DRAWING_OCR_PIXELS,
    }).metadata();
    const w = metadata.width,
      h = metadata.height;
    if (
      !Number.isInteger(w) ||
      !Number.isInteger(h) ||
      w <= 0 ||
      h <= 0 ||
      w * h > MAX_DRAWING_OCR_PIXELS
    )
      throw Error("Invalid drawing size");
    const region = input.region ?? { left: 0, top: 0, width: 1, height: 1 };
    const left = Math.floor(region.left * w),
      top = Math.floor(region.top * h);
    const width = Math.max(1, Math.min(w - left, Math.ceil(region.width * w)));
    const height = Math.max(1, Math.min(h - top, Math.ceil(region.height * h)));
    directory = await mkdtemp(path.join(tmpdir(), "foreman-drawing-ocr-"));
    const filename = path.join(directory, "region.png");
    const raster = await sharp(bytes, {
      limitInputPixels: MAX_DRAWING_OCR_PIXELS,
    })
      .extract({ left, top, width, height })
      .resize({
        width: 2500,
        height: 2500,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer({ resolveWithObject: true });
    await writeFile(filename, raster.data, { mode: 0o600 });
    const { stdout } = await execute(
      "tesseract",
      [filename, "stdout", "--psm", "11", "tsv"],
      {
        signal: request.signal,
        timeout: 15_000,
        maxBuffer: 2_000_000,
        env: {
          NODE_ENV: process.env.NODE_ENV,
          PATH: process.env.PATH,
          OMP_THREAD_LIMIT: "1",
        },
      },
    );
    const words = drawingOcrWords(stdout, {
      sheetWidth: w,
      sheetHeight: h,
      left,
      top,
      cropWidth: width,
      cropHeight: height,
      rasterWidth: raster.info.width,
      rasterHeight: raster.info.height,
    });
    return reply({ words, source: "ocr" });
  } catch {
    return reply(
      {
        error:
          "Text recognition could not finish. The drawing is unchanged; try a smaller region.",
      },
      503,
    );
  } finally {
    active--;
    if (directory)
      await rm(directory, { recursive: true, force: true }).catch(
        () => undefined,
      );
  }
}
