import { spawn } from "node:child_process";
import path from "node:path";
import { auth } from "@clerk/nextjs/server";
import { and, eq, like } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getUserPermissions } from "~/server/auth/permissions";
import { db } from "~/server/db";
import { jobFloors, jobs } from "~/server/db/schema";
import { ensureUser } from "~/server/utils/ensure-user";
import { getAgentBypassUser } from "~/server/utils/get-agent-bypass-user";
import { getDevBypassUser } from "~/server/utils/get-dev-bypass-user";
import {
  appendChunk,
  assertOwner,
  boundedBody,
  CHUNK_BYTES,
  createUpload,
  readSession,
  releaseWorker,
  reserveWorker,
  saveSession,
  sessionDir,
  UploadError,
  UUID,
  withLock,
  WORKER_SECONDS,
} from "~/server/rooms/upload-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 30;

async function requestUser(request: Request) {
  const { userId } = await auth();
  const user = userId
    ? await ensureUser(userId)
    : ((await getAgentBypassUser(request.headers)) ??
      (await getDevBypassUser()));
  if (!user?.organizationId) throw new UploadError("Unauthorized", 401);
  if (!getUserPermissions(user).isManagingAccount)
    throw new UploadError("Managing accounts upload floor plans", 403);
  return { userId: user.id, organizationId: user.organizationId };
}
async function checkJob(jobId: string, organizationId: string) {
  if (!UUID.test(jobId)) throw new UploadError("Job id required");
  const [job] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, organizationId)))
    .limit(1);
  if (!job) throw new UploadError("Job not found", 404);
}
function fail(error: unknown) {
  if (!(error instanceof UploadError))
    console.error("[pdf-upload] request failed", error);
  return NextResponse.json(
    {
      error:
        error instanceof UploadError
          ? error.message
          : "PDF upload failed; existing drawings were not replaced",
    },
    {
      status: error instanceof UploadError ? error.status : 500,
      headers: { "Cache-Control": "no-store", "Retry-After": "3" },
    },
  );
}

async function startUploadWorker(id: string) {
  const child = spawn(
    path.join(process.cwd(), "scripts/run-upload-worker.sh"),
    [id, String(WORKER_SECONDS)],
    {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: "ignore",
    },
  );
  child.once("exit", () => {
    void readSession(id)
      .then(async (latest) => {
        if (latest.status === "processing") {
          await saveSession({
            ...latest,
            status: "error",
            error:
              "PDF worker stopped, exceeded its resource limit, or could not start. Existing drawings are unchanged; inspect the app journal.",
          });
        }
        await releaseWorker(id);
      })
      .catch((error) => console.error("[pdf-upload] worker exit", id, error));
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", resolve);
  });
  child.unref();
}

export async function POST(request: Request) {
  try {
    const owner = await requestUser(request);
    const url = new URL(request.url);
    const id = url.searchParams.get("uploadId");
    if (!id) {
      if (!request.headers.get("content-type")?.includes("application/json"))
        throw new UploadError(
          "Reload ForemenHQ to use resumable PDF uploads. Existing drawings are unchanged",
          400,
        );
      let input;
      try {
        input = JSON.parse(
          (await boundedBody(request, 2048)).toString("utf8"),
        ) as { jobId: string; filename: string; size: number };
      } catch (e) {
        if (e instanceof UploadError) throw e;
        throw new UploadError("Invalid upload metadata");
      }
      if (!input || typeof input.jobId !== "string")
        throw new UploadError("Job id required");
      await checkJob(input.jobId, owner.organizationId);
      const s = await createUpload(input, owner);
      return NextResponse.json({
        uploadId: s.id,
        received: s.received,
        chunkBytes: CHUNK_BYTES,
      });
    }
    const s = await readSession(id);
    assertOwner(s, owner.userId, owner.organizationId);
    await checkJob(s.jobId, owner.organizationId);
    const action = url.searchParams.get("action");
    if (action !== "finish" && action !== "retry") {
      const offsetText = url.searchParams.get("offset");
      if (!offsetText || !/^\d+$/.test(offsetText))
        throw new UploadError("Chunk offset required");
      const next = await appendChunk(id, Number(offsetText), () =>
        boundedBody(request, CHUNK_BYTES),
      );
      return NextResponse.json({ uploadId: id, received: next.received });
    }
    return await withLock(path.join(sessionDir(id), "chunk.lock"), async () => {
      const current = await readSession(id);
      const canStart =
        current.status === "receiving" ||
        (action === "retry" && current.status === "error");
      if (!canStart)
        return NextResponse.json(
          { uploadId: id, status: current.status },
          { status: 202 },
        );
      if (current.received !== current.size)
        throw new UploadError("PDF upload is incomplete", 409);
      const release = await reserveWorker(id);
      try {
        const { error: _priorError, ...retryable } = current;
        await saveSession({
          ...retryable,
          status: "processing",
          startedAt: Date.now(),
        });
        // A detached launcher moves only the renderer into a delegated cgroup.
        // This bounds native memory/processes/CPU without relying on the stale
        // user-manager D-Bus, and it survives an HTTP-server restart.
        await startUploadWorker(id);
      } catch (e) {
        await saveSession(current);
        await release();
        throw e;
      }
      return NextResponse.json(
        { uploadId: id, status: "processing" },
        { status: 202 },
      );
    });
  } catch (error) {
    return fail(error);
  }
}
export async function GET(request: Request) {
  try {
    const owner = await requestUser(request);
    const id = new URL(request.url).searchParams.get("uploadId") ?? "";
    const s = await readSession(id);
    assertOwner(s, owner.userId, owner.organizationId);
    await checkJob(s.jobId, owner.organizationId);
    // A crash after DB commit but before state.json is recoverable without reimport.
    const floors = await db
      .select({
        id: jobFloors.id,
        name: jobFloors.name,
        imageUrl: jobFloors.imageUrl,
        pageNumber: jobFloors.pageNumber,
      })
      .from(jobFloors)
      .where(
        and(
          eq(jobFloors.jobId, s.jobId),
          eq(jobFloors.organizationId, owner.organizationId),
          like(
            jobFloors.imageUrl,
            `/api/job-rooms/files/${s.jobId}/${id}/floor-%`,
          ),
        ),
      );
    const timedOut =
      s.status === "processing" &&
      Date.now() - (s.startedAt ?? 0) > (WORKER_SECONDS + 15) * 1000;
    return NextResponse.json(
      {
        uploadId: id,
        received: s.received,
        status: floors.length ? "ready" : timedOut ? "error" : s.status,
        ...(floors.length ? { floors } : {}),
        error: timedOut
          ? "PDF processing stopped or timed out. Existing drawings are unchanged; the uploaded source is retained for recovery"
          : s.error,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}
