import { randomUUID } from "node:crypto";
import {
  mkdir,
  link,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
  readdir,
  stat,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { MAX_DRAWING_UPLOAD_BYTES, MAX_DRAWING_UPLOAD_MB } from "../../lib/drawing-upload-limits";
import {
  processIdentity,
  sameProcess,
  type ProcessIdentity,
} from "./process-identity";

export const UPLOAD_BYTES = MAX_DRAWING_UPLOAD_BYTES;
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
  /** Set when the PDF goes into a Drawings folder instead of Rooms. */
  drawingSetId?: string;
  received: number;
  createdAt: number;
  status: "receiving" | "processing" | "ready" | "error";
  startedAt?: number;
  restartRequired?: boolean;
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
  const handle = await open(tmp, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(s)); await handle.sync(); }
  finally { await handle.close(); }
  await rename(tmp, dest);
  const dir = await open(sessionDir(s.id), "r");
  try { await dir.sync(); } finally { await dir.close(); }
}
type Lease = { token: string; owner: ProcessIdentity; sessionId?: string };
async function readLease(filename: string): Promise<Lease | null> {
  try {
    return JSON.parse(await readFile(filename, "utf8")) as Lease;
  } catch {
    return null;
  }
}
async function publishLease(filename: string, lease: Lease) {
  const tmp = `${filename}.${randomUUID()}.tmp`;
  const handle = await open(tmp, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(lease));
    await handle.sync();
    await link(tmp, filename); // Atomic exclusive publication; no empty-lock window.
  } finally {
    await handle.close();
    await unlink(tmp).catch(() => undefined);
  }
}
async function acquireLease(filename: string, sessionId?: string) {
  const owner = await processIdentity();
  if (!owner) throw new Error("Cannot identify upload lock owner");
  const lease: Lease = {
    token: randomUUID(),
    owner,
    ...(sessionId ? { sessionId } : {}),
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await publishLease(filename, lease);
      return lease;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const prior = await readLease(filename);
    const info = await stat(filename).catch(() => null);
    const bootTime =
      Number(
        /^btime (\d+)$/m.exec(await readFile("/proc/stat", "utf8"))?.[1] ??
          0,
      ) * 1000;
    const dead = prior?.owner
      ? !(await sameProcess(prior.owner))
      : !!info &&
        (info.mtimeMs < bootTime || Date.now() - info.mtimeMs > UPLOAD_TTL);
    if (
      !dead ||
      (filename.endsWith("worker.lock") &&
        (await rendererExists(prior?.sessionId)))
    )
      throw new UploadError("Upload busy; retry shortly", 409);
    const guardName = `${filename}.recovery`;
    try {
      await publishLease(guardName, lease);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const guard = await readLease(guardName);
      if (!guard?.owner || (await sameProcess(guard.owner)))
        throw new UploadError("Upload recovery busy; retry shortly", 409);
      await releaseLease(guardName, guard.token);
      try {
        await publishLease(guardName, lease);
      } catch {
        throw new UploadError("Upload recovery busy; retry shortly", 409);
      }
    }
    try {
      const current = await stat(filename).catch(() => null);
      if (
        current &&
        current.ino === info?.ino &&
        current.mtimeMs === info.mtimeMs
      )
        await unlink(filename);
    } finally {
      await releaseLease(guardName, lease.token);
    }
  }
  throw new UploadError("Upload busy; retry shortly", 409);
}
// A detached launcher may outlive its HTTP parent. Inspect cgroup membership as
// well as process identity before reclaiming a worker reservation.
async function rendererExists(sessionId?: string) {
  const ids = sessionId
    ? [sessionId]
    : (await readdir(uploadRoot())).filter((id) => UUID.test(id));
  for (const id of ids) {
    for (const pid of await readdir("/proc")) {
      if (!/^\d+$/.test(pid)) continue;
      const group = await readFile(`/proc/${pid}/cgroup`, "utf8").catch(
        () => "",
      );
      if (group.includes(`foremenhq-upload-${id}`)) return true;
      const command = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(
        () => "",
      );
      if (
        (command.includes("run-upload-worker.sh") ||
          command.includes("upload-worker.ts")) &&
        command.split("\0").includes(id)
      )
        return true;
    }
  }
  return false;
}
async function releaseLease(filename: string, token: string) {
  if ((await readLease(filename))?.token === token)
    await unlink(filename).catch(() => undefined);
}
export async function withLock<T>(
  filename: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lease = await acquireLease(filename);
  try {
    return await fn();
  } finally {
    await releaseLease(filename, lease.token);
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
  input: { jobId: string; filename: string; size: number; drawingSetId?: string },
  owner: { userId: string; organizationId: string },
) {
  if (input.drawingSetId !== undefined && !UUID.test(input.drawingSetId))
    throw new UploadError("Drawing set id is invalid");
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
    throw new UploadError(`PDF must be between 5 bytes and ${MAX_DRAWING_UPLOAD_MB} MB`, 413);
  await mkdir(uploadRoot(), { recursive: true });
  return withLock(path.join(uploadRoot(), "init.lock"), async () => {
    // Bound abandoned receiving data: at most eight live reservations, one per user.
    const active: UploadSession[] = [];
    for (const id of await readdir(uploadRoot())) {
      if (!UUID.test(id)) continue;
      const s = await readSession(id).catch(() => null);
      if (s && s.status === "receiving") {
        if (Date.now() - s.createdAt >= UPLOAD_TTL) {
          await withLock(path.join(sessionDir(id), "chunk.lock"), async () => {
            const latest = await readSession(id);
            if (
              latest.status === "receiving" &&
              Date.now() - latest.createdAt >= UPLOAD_TTL
            ) {
              await saveSession({
                ...latest,
                status: "error",
                error: "Upload expired; select the file again",
              });
              await rm(path.join(sessionDir(id), "upload.pdf"), {
                force: true,
              });
            }
          }).catch((error) => {
            if (!(error instanceof UploadError)) throw error;
            active.push(s);
          });
        } else active.push(s);
      }
    }

    const prior = active.find((s) => s.userId === owner.userId);
    if (
      prior &&
      prior.organizationId === owner.organizationId &&
      prior.jobId === input.jobId &&
      prior.filename === input.filename &&
      prior.size === input.size &&
      prior.drawingSetId === input.drawingSetId &&
      Date.now() - prior.createdAt < UPLOAD_TTL
    )
      return prior;
    if (active.length >= 8 || prior)
      throw new UploadError(
        "An unfinished upload already exists; resume it or ask an administrator to clear abandoned upload staging",
        409,
      );
    const s: UploadSession = {
      jobId: input.jobId,
      filename: input.filename,
      size: input.size,
      ...(input.drawingSetId ? { drawingSetId: input.drawingSetId } : {}),
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
  const lease = await readLease(lock);
  if (lease?.sessionId === id) await releaseLease(lock, lease.token);
  else if ((await readFile(lock, "utf8").catch(() => "")) === id)
    await unlink(lock).catch(() => undefined);
}
export async function handoffWorker(id: string, pid: number) {
  const lock = path.join(uploadRoot(), "worker.lock");
  const lease = await readLease(lock);
  const owner = await processIdentity(pid);
  if (lease?.sessionId === id && owner) {
    const tmp = `${lock}.${lease.token}.tmp`;
    await writeFile(tmp, JSON.stringify({ ...lease, owner }));
    await rename(tmp, lock);
  }
}
export async function workerIsAlive(id: string) {
  const lease = await readLease(path.join(uploadRoot(), "worker.lock"));
  return (
    (lease?.sessionId === id && (await sameProcess(lease.owner))) ||
    (await rendererExists(id))
  );
}
export async function recoverProcessingSession(id: string) {
  return withLock(path.join(sessionDir(id), "chunk.lock"), async () => {
    const session = await readSession(id);
    if (
      session.status === "receiving" &&
      Date.now() - session.createdAt >= UPLOAD_TTL
    ) {
      session.status = "error";
      session.restartRequired = true;
      session.error = "Upload expired; select the file again";
      await saveSession(session);
      await rm(path.join(sessionDir(id), "upload.pdf"), { force: true });
    }
    if (
      session.status === "processing" &&
      !(await workerIsAlive(id)) &&
      Date.now() - (session.startedAt ?? session.createdAt) > 15_000
    ) {
      session.status = "error";
      session.error =
        "PDF processing stopped. Retry processing to use the saved upload";
      await saveSession(session);
      await releaseWorker(id);
    }
    return session;
  });
}
export async function reserveWorker(id: string = randomUUID()) {
  try {
    await acquireLease(path.join(uploadRoot(), "worker.lock"), id);
  } catch (error) {
    if (error instanceof UploadError)
      throw new UploadError("Another PDF is processing; retry shortly", 429);
    throw error;
  }
  return async () => releaseWorker(id);
}
