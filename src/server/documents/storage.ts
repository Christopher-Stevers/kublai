import { openStreamingFile } from "../utils/open-streaming-file";
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { TRPCError } from "@trpc/server";

export const MAX_DOCUMENT_FILE_BYTES = 50 * 1024 * 1024;
export const documentStorageRoot = path.resolve(
  process.env.JOB_DOCUMENT_STORAGE_ROOT ??
    path.join(process.cwd(), "uploads", "job-documents"),
);
export function safeDocumentName(name: string) {
  return (
    path
      .basename(name.replaceAll("\\", "/"))
      .replace(/[\x00-\x1f\x7f]/g, "")
      .trim()
      .slice(0, 200) || "document"
  );
}
/** Only byte-verified passive formats render inline. Everything else downloads. */
export function detectedDocumentMime(data: Uint8Array, name: string): string {
  const bytes = Buffer.from(data);
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-")
    return "application/pdf";
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii")))
    return "image/gif";
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  const extension = path.extname(name).toLowerCase();
  if (bytes[0] === 80 && bytes[1] === 75) {
    const office: Record<string, string> = {
      ".docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xlsx":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".pptx":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
    return office[extension] ?? "application/zip";
  }
  return "application/octet-stream";
}
export function documentBlobPath(organizationId: string, sha256: string) {
  if (
    !/^[a-f0-9-]{36}$/i.test(organizationId) ||
    !/^[a-f0-9]{64}$/.test(sha256)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid storage identifier.",
    });
  return path.join(
    documentStorageRoot,
    organizationId,
    sha256.slice(0, 2),
    sha256,
  );
}
export async function writeDocumentBlob(
  organizationId: string,
  bytes: Uint8Array,
) {
  if (!bytes.length || bytes.length > MAX_DOCUMENT_FILE_BYTES)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "Upload a nonempty file no larger than 50 MB.",
    });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const target = documentBlobPath(organizationId, sha256);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    // Hard-link publication is atomic, does not replace an immutable version and
    // cannot expose a partially written duplicate to a concurrent upload.
    await link(temporary, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  // Persist directory entries before PostgreSQL can commit their metadata.
  for (const directory of [
    path.dirname(target),
    path.dirname(path.dirname(target)),
    documentStorageRoot,
  ]) {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  return sha256;
}
export async function readDocumentBlob(organizationId: string, sha256: string) {
  try {
    return await readFile(documentBlobPath(organizationId, sha256));
  } catch {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "The stored file is unavailable. Contact your administrator.",
    });
  }
}

export async function openDocumentBlob(organizationId: string, sha256: string) {
  try {
    return await openStreamingFile(documentBlobPath(organizationId, sha256));
  } catch {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "The stored file is unavailable. Contact your administrator.",
    });
  }
}
