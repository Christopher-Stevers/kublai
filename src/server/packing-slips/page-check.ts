/** A quick text read of one page captured by the scanner, while the scan is
 * still going, so it can count the slip's printed page numbers. Web only:
 * the image and text are not kept, and nothing goes into logs. */
import { execFile } from "node:child_process";
import sharp from "sharp";
import { TRPCError } from "@trpc/server";

export const PAGE_CHECK_BYTES = 8 * 1024 * 1024;
/** Text past this is not needed to find page numbers or compare pages. */
const TEXT_LIMIT = 20_000;
/** Reads at once on this server; a busy scanner just skips the count. */
const AT_ONCE = 2;
let running = 0;

export async function readCapturedPage(bytes: Uint8Array) {
  if (running >= AT_ONCE)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Page check is busy.",
    });
  running++;
  try {
    const png = await sharp(bytes, { limitInputPixels: 24_000_000 })
      .rotate()
      .grayscale()
      // Below about 2000 px the small "Page 1 of 3" print starts to misread.
      .resize({
        width: 2400,
        height: 2400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer()
      .catch(() => {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Send a JPEG or PNG page.",
        });
      });
    // Not read, e.g. too slow or no tesseract here: the scanner skips the count.
    const text = await new Promise<string | null>((resolve) => {
      const child = execFile(
        "tesseract",
        ["stdin", "stdout", "-l", "eng", "--psm", "11"],
        {
          encoding: "utf8",
          timeout: 20_000,
          maxBuffer: 2 * 1024 * 1024,
          env: { ...process.env, OMP_THREAD_LIMIT: "1" },
        },
        (error, stdout) => resolve(error ? null : stdout),
      );
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(png);
    });
    return text?.slice(0, TEXT_LIMIT) ?? null;
  } finally {
    running--;
  }
}
