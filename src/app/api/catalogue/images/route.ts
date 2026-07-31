import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import {
  checksumCatalogueImage,
  convertCatalogueImageUpload,
  getCatalogueImageUrl,
  makeCatalogueImageFilename,
  validateCatalogueImageFile,
  writeCatalogueImage,
} from "~/server/catalogue/image-storage";
import { getUserPermissions } from "~/server/auth/permissions";
import { db } from "~/server/db";
import { photoAssets } from "~/server/db/schema";
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
    return NextResponse.json(
      { error: "Organization required" },
      { status: 403 },
    );
  }
  if (!getUserPermissions(user).canEditParts) {
    return NextResponse.json(
      { error: "You do not have permission to edit parts." },
      { status: 403 },
    );
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
    const url = getCatalogueImageUrl(filename);
    const [asset] = await db
      .insert(photoAssets)
      .values({
        organizationId: user.organizationId,
        storageKey: filename,
        url,
        originalFilename: file.name || filename,
        contentType: "image/webp",
        byteSize: outputBuffer.byteLength,
        checksum: checksumCatalogueImage(outputBuffer),
      })
      .onConflictDoUpdate({
        target: [photoAssets.organizationId, photoAssets.url],
        set: {
          byteSize: outputBuffer.byteLength,
          checksum: checksumCatalogueImage(outputBuffer),
          updatedAt: new Date(),
        },
      })
      .returning({ id: photoAssets.id });

    return NextResponse.json({ url, assetId: asset?.id ?? null });
  } catch {
    return NextResponse.json(
      { error: "Could not process image" },
      { status: 400 },
    );
  }
}
