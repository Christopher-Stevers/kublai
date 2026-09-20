import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
  readdir,
} from "node:fs/promises";
import path from "node:path";

export const UPLOAD_BYTES = 100 * 1024 * 1024;
export const CHUNK_BYTES = 5 * 1024 * 1024;
export const UPLOAD_TTL = 60 * 60_000;
export { DRAWING_WORKER_SECONDS as WORKER_SECONDS } from "~/lib/drawing-upload-limits";
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uploadRoot = () =>
  path.join(process.cwd(), "uploads", "job-floor-plans", ".upload-sessions");
export type UploadSheet = {
  id: string;
  name: string;
  imageUrl: string;
  pageNumber: number;
};
export type UploadSession = {
  id: string;
  jobId: string;
  userId: string;
  organizationId: string;
  filename: string;
  size: number;
  received: number;
  createdAt: number;
  status: "receiving" | "processing" | "ready" | "error";
  startedAt?: number;
  error?: string;
  floors?: UploadSheet[];
};
export class UploadError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function sessionDir(id: string) {
  if (!UUID.test(id)) throw new UploadError("Invalid upload id");
  return path.join(uploadRoot(), id);
}
export async function readSession(id: string): Promise<UploadSession> {
  try {
    return JSON.parse(
      await readFile(path.join(sessionDir(id), "state.json"), "utf8"),
    ) as UploadSession;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      throw new UploadError("Upload not found", 404);
    throw e;
  }
}
export async function saveSession(s: UploadSession) {
  const dest = path.join(sessionDir(s.id), "state.json");
  const tmp = `${dest}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(s));
  await rename(tmp, dest);
}
export async function withLock<T>(
  filename: string,
  fn: () => Promise<T>,
): Promise<T> {
  let handle;
  try {
    handle = await open(filename, "wx");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST")
      throw new UploadError("Upload busy; retry shortly", 409);
    throw e;
  }
  try {
    return await fn();
  } finally {
    await handle.close();
    await unlink(filename);
  }
}
export async function boundedBody(
  request: Request,
  maximum: number,
): Promise<Buffer> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum))
    throw new UploadError("Upload request too large", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new UploadError("Upload body required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, 30_000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new UploadError("Upload request too large", 413);
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof UploadError) throw e;
    throw new UploadError("Upload interrupted; retry the file", 400);
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  if (timedOut)
    throw new UploadError("Upload chunk timed out; retry to resume", 408);
  return Buffer.concat(chunks, size);
}
export async function createUpload(
  input: { jobId: string; filename: string; size: number },
  owner: { userId: string; organizationId: string },
) {
  if (
    !UUID.test(input.jobId) ||
    typeof input.filename !== "string" ||
    !input.filename.toLowerCase().endsWith(".pdf") ||
    input.filename.length > 255
  )
    throw new UploadError("A job id and PDF filename are required");
  if (
    !Number.isSafeInteger(input.size) ||
    input.size < 5 ||
    input.size > UPLOAD_BYTES
  )
    throw new UploadError("PDF must be between 5 bytes and 100 MB", 413);
  await mkdir(uploadRoot(), { recursive: true });
  return withLock(path.join(uploadRoot(), "init.lock"), async () => {
    // Bound abandoned receiving data: at most eight live reservations, one per user.
    const active: UploadSession[] = [];
    for (const id of await readdir(uploadRoot())) {
      if (!UUID.test(id)) continue;
      const s = await readSession(id).catch(() => null);
      if (s && s.status === "receiving") active.push(s);
    }
    // Expired reservations stay counted until operator cleanup, rather than permitting unbounded disk use.
    const prior = active.find((s) => s.userId === owner.userId);
    if (
      prior &&
      prior.organizationId === owner.organizationId &&
      prior.jobId === input.jobId &&
      prior.filename === input.filename &&
      prior.size === input.size &&
      Date.now() - prior.createdAt < UPLOAD_TTL
    )
      return prior;
    if (active.length >= 8 || prior)
      throw new UploadError(
        "An unfinished upload already exists; resume it or ask an administrator to clear abandoned upload staging",
        409,
      );
    const s: UploadSession = {
      ...input,
      ...owner,
      id: randomUUID(),
      received: 0,
      createdAt: Date.now(),
      status: "receiving",
    };
    await mkdir(sessionDir(s.id));
    await writeFile(path.join(sessionDir(s.id), "upload.pdf"), Buffer.alloc(0));
    await saveSession(s);
    return s;
  });
}
export function assertOwner(
  s: UploadSession,
  userId: string,
  organizationId: string,
) {
  if (s.userId !== userId || s.organizationId !== organizationId)
    throw new UploadError("Upload not found", 404);
}
export async function appendChunk(
  id: string,
  offset: number,
  input: Buffer | (() => Promise<Buffer>),
) {
  return withLock(path.join(sessionDir(id), "chunk.lock"), async () => {
    const s = await readSession(id);
    if (s.status !== "receiving" || Date.now() - s.createdAt > UPLOAD_TTL)
      throw new UploadError("Upload is no longer receiving chunks", 409);
    // Acquire the per-session lock BEFORE buffering: at most eight admitted
    // receiving sessions can each hold one 5 MB chunk in the HTTP process.
    const body = typeof input === "function" ? await input() : input;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset % CHUNK_BYTES !== 0 ||
      offset >= s.size ||
      body.length !== Math.min(CHUNK_BYTES, s.size - offset)
    )
      throw new UploadError("Incorrect upload chunk length or offset");
    if (offset > s.received)
      throw new UploadError("Upload chunk out of order", 409);
    const file = await open(path.join(sessionDir(id), "upload.pdf"), "r+");
    try {
      if (offset < s.received) {
        const prior = Buffer.alloc(body.length);
        const { bytesRead } = await file.read(prior, 0, prior.length, offset);
        if (bytesRead !== body.length || !prior.equals(body))
          throw new UploadError("Retried chunk differs from saved bytes", 409);
        return s;
      }
      let written = 0;
      while (written < body.length) {
        const result = await file.write(
          body,
          written,
          body.length - written,
          offset + written,
        );
        if (!result.bytesWritten)
          throw new Error("Could not save upload chunk");
        written += result.bytesWritten;
      }
      await file.sync();
      s.received += body.length;
      await saveSession(s);
      return s;
    } finally {
      await file.close();
    }
  });
}
export async function releaseWorker(id: string) {
  const lock = path.join(uploadRoot(), "worker.lock");
  if ((await readFile(lock, "utf8").catch(() => "")) === id)
    await unlink(lock).catch(() => undefined);
}
export async function reserveWorker(id: string = randomUUID()) {
  const lock = path.join(uploadRoot(), "worker.lock");
  try {
    const handle = await open(lock, "wx");
    try {
      await handle.writeFile(id);
    } finally {
      await handle.close();
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST")
      throw new UploadError("Another PDF is processing; retry shortly", 429);
    throw e;
  }
  // No age-only lock stealing: a restarted HTTP process must not launch a
  // second native renderer while the first transient service remains alive.
  return async () => releaseWorker(id);
}
