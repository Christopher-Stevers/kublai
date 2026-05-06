import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { auth } from "@clerk/nextjs/server";
import sharp from "sharp";
import { NextResponse } from "next/server";

import { ensureUser } from "~/server/utils/ensure-user";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const UPLOAD_DIR = path.join(process.cwd(), "public", "images", "catalog", "uploads");
const PUBLIC_PREFIX = "/api/catalogue/images";

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

  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Uploaded file must be an image" }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Image must be smaller than 8MB" }, { status: 400 });
  }

  const inputBuffer = Buffer.from(await file.arrayBuffer());
  const outputBuffer = await sharp(inputBuffer)
    .rotate()
    .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();

  await mkdir(UPLOAD_DIR, { recursive: true });

  const filename = `part-${randomUUID()}.webp`;
  const outputPath = path.join(UPLOAD_DIR, filename);
  await writeFile(outputPath, outputBuffer);

  return NextResponse.json({ url: `${PUBLIC_PREFIX}/${filename}` });
}
