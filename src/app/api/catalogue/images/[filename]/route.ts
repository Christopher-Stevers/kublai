import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const UPLOAD_DIR = path.join(process.cwd(), "public", "images", "catalog", "uploads");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;

  if (!/^part-[0-9a-f-]+\.webp$/i.test(filename)) {
    return NextResponse.json({ error: "Invalid image filename" }, { status: 400 });
  }

  try {
    const image = await readFile(path.join(UPLOAD_DIR, filename));
    return new NextResponse(image, {
      headers: {
        "content-type": "image/webp",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }
}
