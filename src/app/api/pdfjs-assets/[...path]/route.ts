import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Serves PDF.js's worker, decoder (wasm) and standard-font files to the browser, so the
 * drawing viewer can render scanned/JBIG2 images and non-embedded fonts. Read
 * from the installed package instead of copying binaries into `public/`.
 */
const ALLOWED =
  /^(legacy\/build\/pdf\.worker\.min\.mjs|wasm\/[a-z0-9_-]+\.(?:wasm|js)|standard_fonts\/[A-Za-z0-9_-]+\.(?:pfb|ttf))$/;
const TYPES: Record<string, string> = {
  wasm: "application/wasm",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  pfb: "application/octet-stream",
  ttf: "font/ttf",
};

function packageRoot() {
  return path.dirname(
    process
      .getBuiltinModule("module")
      .createRequire(path.join(process.cwd(), "package.json"))
      .resolve("pdfjs-dist/package.json"),
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const relative = (await context.params).path.join("/");
  if (!ALLOWED.test(relative))
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    const body = await readFile(path.join(packageRoot(), relative));
    return new NextResponse(body, {
      headers: {
        "Content-Type": TYPES[relative.split(".").pop()!] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
