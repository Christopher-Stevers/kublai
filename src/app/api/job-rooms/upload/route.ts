import { spawn } from "node:child_process";
import path from "node:path";
import { and, eq, like } from "drizzle-orm";
import { NextResponse } from "next/server";
import { userCan } from "~/server/auth/permissions";
import { db } from "~/server/db";
import { jobDrawingSets, jobDrawingSheets, jobFloors, jobs } from "~/server/db/schema";
import {
  appendChunk,
  handoffWorker,
  recoverProcessingSession,
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

import { ensureDrawingTiles, uploadsFromImageUrls } from "~/server/rooms/tiles";
import { getRequestIdentity } from "~/server/utils/get-request-identity";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 30;

async function requestUser(request: Request) {
  const { user } = await getRequestIdentity(request.headers, { allowDev: true });
  if (!user?.organizationId) throw new UploadError("Unauthorized", 401);
  if (!userCan(user, "drawings.manage"))
    throw new UploadError("You don't have permission to upload drawings", 403);
  return { userId: user.id, organizationId: user.organizationId };
}
async function checkDrawingSet(setId: string, jobId: string, organizationId: string) {
  if (!UUID.test(setId)) throw new UploadError("Drawing set id is invalid");
  const [set] = await db
    .select({ id: jobDrawingSets.id })
    .from(jobDrawingSets)
    .where(
      and(
        eq(jobDrawingSets.id, setId),
        eq(jobDrawingSets.jobId, jobId),
        eq(jobDrawingSets.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!set) throw new UploadError("Drawing folder not found", 404);
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
      env: { ...process.env, FOREMANHQ_NODE_BINARY: process.execPath },
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
  if (child.pid) await handoffWorker(id, child.pid);
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
        ) as { jobId: string; filename: string; size: number; drawingSetId?: unknown };
      } catch (e) {
        if (e instanceof UploadError) throw e;
        throw new UploadError("Invalid upload metadata");
      }
      if (!input || typeof input.jobId !== "string")
        throw new UploadError("Job id required");
      await checkJob(input.jobId, owner.organizationId);
      if (
        input.drawingSetId !== undefined &&
        input.drawingSetId !== null &&
        typeof input.drawingSetId !== "string"
      )
        throw new UploadError("Drawing set id is invalid");
      const drawingSetId = input.drawingSetId ?? undefined;
      if (drawingSetId)
        await checkDrawingSet(drawingSetId, input.jobId, owner.organizationId);
      const s = await createUpload(
        { jobId: input.jobId, filename: input.filename, size: input.size, drawingSetId },
        owner,
      );
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
    if (action === "retry") await recoverProcessingSession(id);
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
    if (s.drawingSetId) {
      // Drawings: same recovery idea, against the folder's sheets.
      const sheets = await db
        .select({ id: jobDrawingSheets.id, imageUrl: jobDrawingSheets.imageUrl })
        .from(jobDrawingSheets)
        .where(
          and(
            eq(jobDrawingSheets.setId, s.drawingSetId),
            eq(jobDrawingSheets.organizationId, owner.organizationId),
            like(jobDrawingSheets.imageUrl, `/api/job-rooms/files/${s.jobId}/${id}/floor-%`),
          ),
        );
      const current = sheets.length
        ? { ...s, status: "ready" as const }
        : await recoverProcessingSession(id);
      // Sharper zoom tiles are made in the background once the sheets exist.
      for (const upload of uploadsFromImageUrls(sheets.map((sheet) => sheet.imageUrl)))
        await ensureDrawingTiles(upload.jobId, upload.uploadId, upload.pages).catch(
          (error: unknown) => console.error("[drawing-tiles] start failed", id, error),
        );
      return NextResponse.json(
        {
          uploadId: id,
          received: s.received,
          status: current.status,
          sheetCount: sheets.length,
          error: current.error,
          restartRequired: current.restartRequired,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
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
    const current = floors.length
      ? { ...s, status: "ready" as const, floors }
      : await recoverProcessingSession(id);
    if (floors.length && s.status !== "ready") {
      await withLock(path.join(sessionDir(id), "chunk.lock"), async () => {
        await saveSession({
          ...(await readSession(id)),
          status: "ready",
          floors,
        });
      });
    }
    return NextResponse.json(
      {
        uploadId: id,
        received: s.received,
        status: current.status,
        ...(floors.length ? { floors } : {}),
        error: current.error,
        restartRequired: current.restartRequired,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}
