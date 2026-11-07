import busboy from "busboy";
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  open,
  opendir,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { TRPCError } from "@trpc/server";
import {
  documentBlobPath,
  documentStorageRoot,
  MAX_DOCUMENT_FILE_BYTES,
  safeDocumentName,
} from "./storage";

const badUpload = () =>
  new TRPCError({
    code: "BAD_REQUEST",
    message: "Choose exactly one file in a valid multipart upload.",
  });
const tooLarge = () =>
  new TRPCError({
    code: "PAYLOAD_TOO_LARGE",
    message: "Upload a nonempty file no larger than 50 MB.",
  });

/** Stage a bounded multipart stream on the blob filesystem. Publish only after fresh authorization. */
export async function receiveDocumentUpload(
  request: Request,
  organizationId: string,
) {
  const limit = MAX_DOCUMENT_FILE_BYTES + 64 * 1024;
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit))
    throw tooLarge();
  if (!request.body) throw badUpload();
  let parser: ReturnType<typeof busboy>;
  try {
    parser = busboy({
      headers: { "content-type": request.headers.get("content-type") ?? "" },
      defParamCharset: "utf8",
      limits: {
        files: 1,
        fields: 16,
        fieldSize: 64 * 1024,
        parts: 17,
        fileSize: MAX_DOCUMENT_FILE_BYTES + 1,
      },
    });
  } catch {
    throw badUpload();
  }
  const orgRoot = path.dirname(
    path.dirname(documentBlobPath(organizationId, "0".repeat(64))),
  );
  const staging = path.join(orgRoot, ".incoming");
  await mkdir(staging, { recursive: true, mode: 0o700 });
  // Interrupted processes cannot run finally; age out their private staging directories.
  const entries = await opendir(staging);
  let inspected = 0;
  for await (const entry of entries) {
    if (++inspected > 1000) break;
    if (!entry.isDirectory() || !entry.name.startsWith("upload-")) continue;
    const target = path.join(staging, entry.name);
    try {
      if (Date.now() - (await stat(target)).mtimeMs > 86_400_000)
        await rm(target, { recursive: true, force: true });
    } catch {
      /* concurrent cleanup */
    }
  }
  const directory = await mkdtemp(path.join(staging, "upload-")),
    temporary = path.join(directory, "file");
  const dispose = () => rm(directory, { recursive: true, force: true });
  const controller = new AbortController();
  let failure: Error | undefined;
  const fail = (error: Error) => {
    failure ??= error;
    controller.abort(error);
  };
  const aborted = () =>
    fail(
      new TRPCError({
        code: "BAD_REQUEST",
        message: "Upload was interrupted. Retry the upload.",
      }),
    );
  request.signal.addEventListener("abort", aborted, { once: true });
  if (request.signal.aborted) aborted();
  const timer = setTimeout(
    () =>
      fail(
        new TRPCError({
          code: "TIMEOUT",
          message: "Upload timed out. Try again.",
        }),
      ),
    60_000,
  );
  const hash = createHash("sha256"),
    fields = new Map<string, string>();
  let size = 0,
    total = 0,
    name: string | undefined,
    header = Buffer.alloc(0),
    writing: Promise<void> | undefined;
  parser.on("filesLimit", () => fail(badUpload()));
  parser.on("fieldsLimit", () => fail(badUpload()));
  parser.on("partsLimit", () => fail(badUpload()));
  parser.on("field", (key, value, info) => {
    if (info.nameTruncated || info.valueTruncated || fields.has(key))
      fail(badUpload());
    else fields.set(key, value);
  });
  parser.on("file", (key, file, info) => {
    if (key !== "file" || name !== undefined) {
      file.resume();
      fail(badUpload());
      return;
    }
    name = safeDocumentName(info.filename);
    file.on("limit", () => fail(tooLarge()));
    writing = pipeline(
      file,
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          size += chunk.length;
          if (size > MAX_DOCUMENT_FILE_BYTES) {
            done(tooLarge());
            return;
          }
          hash.update(chunk);
          if (header.length < 16)
            header = Buffer.concat([
              header,
              chunk.subarray(0, 16 - header.length),
            ]);
          done(null, chunk);
        },
      }),
      createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
      { signal: controller.signal },
    );
    void writing.catch((error) =>
      fail(error instanceof Error ? error : badUpload()),
    );
  });
  try {
    await pipeline(
      Readable.fromWeb(
        request.body as NodeReadableStream,
      ),
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          total += chunk.length;
          done(total > limit ? tooLarge() : null, chunk);
        },
      }),
      parser,
      { signal: controller.signal },
    );
    await writing;
    if (failure) throw failure;
    if (name === undefined || !writing) throw badUpload();
    if (!size) throw tooLarge();
    const sha256 = hash.digest("hex");
    const handle = await open(temporary, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    return {
      name,
      size,
      sha256,
      header,
      fields,
      dispose,
      async publish(this: void) {
        const target = documentBlobPath(organizationId, sha256);
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        try {
          await link(temporary, target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        for (const dir of [
          path.dirname(target),
          orgRoot,
          documentStorageRoot,
        ]) {
          const handle = await open(dir, "r");
          try {
            await handle.sync();
          } finally {
            await handle.close();
          }
        }
        return sha256;
      },
    };
  } catch (error) {
    controller.abort();
    await writing?.catch(() => undefined);
    await dispose();
    throw failure ?? (error instanceof TRPCError ? error : badUpload());
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", aborted);
  }
}
