import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const CATALOGUE_IMAGE_PUBLIC_PREFIX = "/api/catalogue/images";
export const CATALOGUE_IMAGE_CONTENT_TYPE = "image/webp";
export const MAX_CATALOGUE_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_REMOTE_CATALOGUE_IMAGE_BYTES = 12 * 1024 * 1024;

const UPLOAD_DIR = path.join(
  process.cwd(),
  "public",
  "images",
  "catalog",
  "uploads",
);
const UPLOAD_FILENAME_PATTERN = /^part-[0-9a-f-]+\.webp$/i;

type CatalogueImageBucket = {
  put: (
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: { httpMetadata?: { contentType?: string } },
  ) => Promise<unknown>;
  get: (
    key: string,
  ) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> } | null>;
  delete: (key: string) => Promise<void>;
};

async function getCatalogueImageBucket() {
  if (process.env.PHOTO_STORAGE_BACKEND !== "r2") {
    return null;
  }

  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = await getCloudflareContext({ async: true });
    return (
      ((context.env as Record<string, unknown>).CATALOGUE_IMAGES as
        | CatalogueImageBucket
        | undefined) ?? null
    );
  } catch {
    return null;
  }
}

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

export function checksumCatalogueImage(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function isValidCatalogueImageFilename(filename: string) {
  return UPLOAD_FILENAME_PATTERN.test(filename);
}

export function getCatalogueImageUrl(filename: string) {
  return `${CATALOGUE_IMAGE_PUBLIC_PREFIX}/${filename}`;
}

export async function convertCatalogueImageUpload(file: File) {
  return convertRemoteCatalogueImage(Buffer.from(await file.arrayBuffer()));
}

export async function convertRemoteCatalogueImage(inputBuffer: Buffer) {
  const sharp = (await import("sharp")).default;

  return sharp(inputBuffer)
    .rotate()
    .resize({
      width: 1200,
      height: 1200,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 80 })
    .toBuffer();
}

export async function downloadRemoteCatalogueImage(imageUrl: string) {
  const url = new URL(imageUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Image URL must be HTTP or HTTPS");
  }

  const blockedHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
  if (blockedHosts.has(url.hostname.toLowerCase())) {
    throw new Error("Local image URLs are not allowed");
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "ForemenHQ catalogue image picker",
      Accept:
        "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Could not download selected image: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.toLowerCase().startsWith("image/")) {
    throw new Error("Selected URL did not return an image");
  }

  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MAX_REMOTE_CATALOGUE_IMAGE_BYTES) {
    throw new Error("Selected image is too large");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_REMOTE_CATALOGUE_IMAGE_BYTES) {
    throw new Error("Selected image is too large");
  }

  return convertRemoteCatalogueImage(buffer);
}

export async function writeCatalogueImage(filename: string, buffer: Buffer) {
  const bucket = await getCatalogueImageBucket();
  if (bucket) {
    await bucket.put(filename, buffer, {
      httpMetadata: { contentType: CATALOGUE_IMAGE_CONTENT_TYPE },
    });
    return;
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, filename), buffer);
}

export async function readCatalogueImage(filename: string) {
  const bucket = await getCatalogueImageBucket();
  if (bucket) {
    const object = await bucket.get(filename);
    if (!object) throw new Error("Image not found");
    return Buffer.from(await object.arrayBuffer());
  }

  return readFile(path.join(UPLOAD_DIR, filename));
}

export async function deleteCatalogueImage(filename: string) {
  const bucket = await getCatalogueImageBucket();
  if (bucket) {
    await bucket.delete(filename);
    return;
  }

  const { unlink } = await import("node:fs/promises");
  await unlink(path.join(UPLOAD_DIR, filename));
}
