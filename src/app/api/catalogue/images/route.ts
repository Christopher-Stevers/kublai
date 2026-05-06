import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import {
  convertCatalogueImageUpload,
  getCatalogueImageUrl,
  makeCatalogueImageFilename,
  validateCatalogueImageFile,
  writeCatalogueImage,
} from "~/server/catalogue/image-storage";
import { ensureUser } from "~/server/utils/ensure-user";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await ensureUser(userId);
  if (!user?.organizationId) {
    return NextResponse.json({ error: "Organization required" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Image file required" }, { status: 400 });
  }

  const validationError = validateCatalogueImageFile(file);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  try {
    const filename = makeCatalogueImageFilename();
    const outputBuffer = await convertCatalogueImageUpload(file);
    await writeCatalogueImage(filename, outputBuffer);

    return NextResponse.json({ url: getCatalogueImageUrl(filename) });
  } catch {
    return NextResponse.json({ error: "Could not process image" }, { status: 400 });
  }
}
