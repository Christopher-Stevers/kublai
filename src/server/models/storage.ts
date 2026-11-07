import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  writeFile,
  readFile,
  open,
  link,
  unlink,
  stat,
  readdir,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  MAX_MODEL_BYTES,
  MODEL_CHUNK_BYTES,
  uploadMetadataSchema,
  type ModelUploadMetadata,
} from "~/lib/bim/types";
import type { ModelAccess } from "./access";
const root = path.resolve(
  process.env.BIM_STORAGE_ROOT ?? path.join(process.cwd(), "uploads", "bim"),
);
const uuid = z.string().uuid();
export const safeModelFilename = (name: string) =>
  path
    .basename(name.replaceAll("\\", "/"))
    .replace(/[\x00-\x1f\x7f]/g, "")
    .slice(0, 200);
export function modelFormat(name: string): "ifc" | "rvt" {
  const ext = path.extname(name).toLowerCase();
  if (ext !== ".ifc" && ext !== ".rvt")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose an IFC or Revit (.rvt) file.",
    });
  return ext === ".ifc" ? "ifc" : "rvt";
}
export function validateModelHeader(bytes: Uint8Array, format: "ifc" | "rvt") {
  if (format === "ifc") {
    const text = new TextDecoder()
      .decode(bytes)
      .replace(/^\uFEFF/, "")
      .trimStart();
    if (!text.startsWith("ISO-10303-21;") || !text.includes("FILE_SCHEMA"))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "This file is not a STEP IFC model. Export an IFC file from Revit.",
      });
  } else if (
    !Buffer.from(bytes.subarray(0, 8)).equals(
      Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]),
    )
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This file does not have a Revit compound-file header.",
    });
}
export function modelBlobPath(organizationId: string, sha: string) {
  uuid.parse(organizationId);
  if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error("Invalid model hash");
  return path.join(root, organizationId, "files", sha.slice(0, 2), sha);
}
const sessionPath = (access: ModelAccess, id: string) =>
  path.join(
    root,
    uuid.parse(access.job.organizationId),
    "uploads",
    uuid.parse(id),
  );
const sessionSchema = z.object({
  metadata: uploadMetadataSchema,
  userId: z.string(),
  expiresAt: z.number(),
});
export async function startModelUpload(
  access: ModelAccess,
  metadata: ModelUploadMetadata,
) {
  modelFormat(metadata.filename);
  const uploads = path.join(
    root,
    uuid.parse(access.job.organizationId),
    "uploads",
  );
  await mkdir(uploads, { recursive: true, mode: 0o700 });
  let active = 0;
  for (const entry of await readdir(uploads, { withFileTypes: true })) {
    if (!entry.isDirectory() || !uuid.safeParse(entry.name).success) continue;
    const folder = path.join(uploads, entry.name);
    try {
      const saved = sessionSchema.parse(
        JSON.parse(await readFile(path.join(folder, "session.json"), "utf8")),
      );
      if (saved.expiresAt < Date.now()) await rm(folder, { recursive: true });
      else if (
        saved.userId === access.user.id &&
        !(await stat(path.join(folder, "completed.json")).catch(() => null))
      )
        active++;
    } catch {
      /* Ignore unrelated or incomplete sessions. */
    }
  }
  if (active >= 8)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message:
        "Too many unfinished model uploads. Try again after existing uploads expire.",
    });
  const id = randomUUID(),
    folder = sessionPath(access, id);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(folder, "session.json"),
    JSON.stringify({
      metadata: { ...metadata, filename: safeModelFilename(metadata.filename) },
      userId: access.user.id,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    }),
    { flag: "wx", mode: 0o600 },
  );
  return { id, chunkBytes: MODEL_CHUNK_BYTES };
}
async function session(access: ModelAccess, id: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(
      await readFile(
        path.join(sessionPath(access, id), "session.json"),
        "utf8",
      ),
    );
  } catch {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Upload not found. Start the upload again.",
    });
  }
  const result = sessionSchema.parse(raw);
  if (
    result.userId !== access.user.id ||
    result.metadata.jobId !== access.job.id
  )
    throw new TRPCError({ code: "NOT_FOUND" });
  if (result.expiresAt < Date.now())
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The upload expired. Start again.",
    });
  return result.metadata;
}
export async function writeModelChunk(
  access: ModelAccess,
  id: string,
  part: number,
  bytes: Uint8Array,
) {
  const meta = await session(access, id);
  const count = Math.ceil(meta.size / MODEL_CHUNK_BYTES);
  if (
    !Number.isInteger(part) ||
    part < 0 ||
    part >= count ||
    bytes.length !==
      Math.min(MODEL_CHUNK_BYTES, meta.size - part * MODEL_CHUNK_BYTES)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid upload chunk.",
    });
  const target = path.join(sessionPath(access, id), String(part));
  const temporary = target + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await link(temporary, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const old = await readFile(target);
    if (
      !createHash("sha256")
        .update(old)
        .digest()
        .equals(createHash("sha256").update(bytes).digest())
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "This upload chunk changed. Start the upload again.",
      });
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return { part };
}
async function publishBlob(
  organizationId: string,
  temporary: string,
  sha: string,
) {
  const target = modelBlobPath(organizationId, sha);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    await link(temporary, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const f = await open(target, "r");
  try {
    await f.sync();
  } finally {
    await f.close();
  }
  const dir = await open(path.dirname(target), "r");
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
}
export async function finishModelUpload(access: ModelAccess, id: string) {
  const metadata = await session(access, id);
  const folder = sessionPath(access, id);
  const finished = await readFile(
    path.join(folder, "completed.json"),
    "utf8",
  ).catch(() => null);
  if (finished) {
    const result = z
      .object({
        sha: z.string().regex(/^[a-f0-9]{64}$/),
        format: z.enum(["ifc", "rvt"]),
      })
      .parse(JSON.parse(finished));
    return { metadata, ...result };
  }
  const count = Math.ceil(metadata.size / MODEL_CHUNK_BYTES);
  for (let i = 0; i < count; i++) {
    const length = await stat(path.join(folder, String(i)))
      .then((s) => s.size)
      .catch(() => -1);
    if (
      length !==
      Math.min(MODEL_CHUNK_BYTES, metadata.size - i * MODEL_CHUNK_BYTES)
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "The upload is incomplete. Retry the missing parts.",
      });
  }
  const temporary = path.join(folder, "complete-" + randomUUID());
  const hash = createHash("sha256");
  let size = 0;
  async function* chunks() {
    for (let i = 0; i < count; i++)
      for await (const chunk of createReadStream(path.join(folder, String(i))))
        yield chunk as Buffer;
  }
  try {
    await pipeline(
      Readable.from(chunks()),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length;
          hash.update(chunk);
          callback(null, chunk);
        },
      }),
      createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
    );
    if (size !== metadata.size)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "The model file size changed during upload.",
      });
    const file = await open(temporary, "r");
    const header = Buffer.alloc(Math.min(size, 65536));
    try {
      await file.read(header, 0, header.length, 0);
    } finally {
      await file.close();
    }
    const format = modelFormat(metadata.filename);
    validateModelHeader(header, format);
    const sha = hash.digest("hex");
    await publishBlob(access.job.organizationId, temporary, sha);
    const receipt = path.join(folder, "completed.json");
    try {
      await writeFile(receipt, JSON.stringify({ sha, format }), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    // Chunks remain until the session expires so parallel completion/retries are safe.
    return { metadata, sha, format };
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
export async function storeConvertedModel(
  organizationId: string,
  bytes: Uint8Array,
) {
  if (!bytes.length || bytes.length > MAX_MODEL_BYTES)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "The converted model exceeds 250 MB.",
    });
  validateModelHeader(bytes.subarray(0, 65536), "ifc");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const target = modelBlobPath(organizationId, sha);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temp = target + "." + randomUUID();
  try {
    await writeFile(temp, bytes, { flag: "wx", mode: 0o600 });
    await publishBlob(organizationId, temp, sha);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
  return sha;
}
