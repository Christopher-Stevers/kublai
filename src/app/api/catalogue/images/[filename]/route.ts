import { NextResponse } from "next/server";

import {
  CATALOGUE_IMAGE_CONTENT_TYPE,
  isValidCatalogueImageFilename,
  readCatalogueImage,
} from "~/server/catalogue/image-storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;

  if (!isValidCatalogueImageFilename(filename)) {
    return NextResponse.json({ error: "Invalid image filename" }, { status: 400 });
  }

  try {
    const image = await readCatalogueImage(filename);
    return new NextResponse(image, {
      headers: {
        "content-type": CATALOGUE_IMAGE_CONTENT_TYPE,
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }
}
