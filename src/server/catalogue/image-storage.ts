import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

export const CATALOGUE_IMAGE_PUBLIC_PREFIX = "/api/catalogue/images";
export const CATALOGUE_IMAGE_CONTENT_TYPE = "image/webp";
export const MAX_CATALOGUE_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;

const UPLOAD_DIR = path.join(process.cwd(), "public", "images", "catalog", "uploads");
const UPLOAD_FILENAME_PATTERN = /^part-[0-9a-f-]+\.webp$/i;

export function validateCatalogueImageFile(file: File) {
  if (!file.type.startsWith("image/")) {
    return "Uploaded file must be an image";
  }

  if (file.size > MAX_CATALOGUE_IMAGE_UPLOAD_BYTES) {
    return "Image must be smaller than 8MB";
  }

  return null;
}

export function makeCatalogueImageFilename() {
  return `part-${randomUUID()}.webp`;
}

export function isValidCatalogueImageFilename(filename: string) {
  return UPLOAD_FILENAME_PATTERN.test(filename);
}

export function getCatalogueImageUrl(filename: string) {
  return `${CATALOGUE_IMAGE_PUBLIC_PREFIX}/${filename}`;
}

export async function convertCatalogueImageUpload(file: File) {
  const inputBuffer = Buffer.from(await file.arrayBuffer());
  return sharp(inputBuffer)
    .rotate()
    .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
}

export async function writeCatalogueImage(filename: string, buffer: Buffer) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, filename), buffer);
}

export async function readCatalogueImage(filename: string) {
  return readFile(path.join(UPLOAD_DIR, filename));
}
