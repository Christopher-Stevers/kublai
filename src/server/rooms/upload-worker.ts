import { renderUploadPdf } from "./upload-render";

// Dedicated upload renderer: never imported into the Next.js request process.
import { copyFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { db } from "~/server/db";
import { jobDrawingSets, jobDrawingSheets, jobFloorPlans, jobFloors, jobs } from "~/server/db/schema";
import {
  readSession,
  saveSession,
  sessionDir,
  releaseWorker,
  type UploadSession,
} from "./upload-session";

async function run(s: UploadSession) {
  const dest = path.join(
    process.cwd(),
    "uploads",
    "job-floor-plans",
    s.jobId,
    s.id,
  );
  await mkdir(dest, { recursive: true });
  // Preserve the complete PDF before processing, including when rendering fails.
  await copyFile(
    path.join(sessionDir(s.id), "upload.pdf"),
    path.join(dest, "plan.pdf"),
  );
  const sheets = await renderUploadPdf(dest, s.jobId, s.id);
  if (s.drawingSetId) {
    await addToDrawingSet(s, s.drawingSetId, sheets);
    await saveSession({ ...s, status: "ready", floors: [] });
    await unlink(path.join(sessionDir(s.id), "upload.pdf"));
    return;
  }
  // Serialize additions to this job and publish ALL pending sheets atomically.
  // Existing floors, rooms, PDF metadata and confirmed state are never replaced.
  const floors = await db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, s.jobId))
      .for("update");
    if (!job || job.organizationId !== s.organizationId)
      throw new Error("Job no longer available");
    let [plan] = await tx
      .select()
      .from(jobFloorPlans)
      .where(eq(jobFloorPlans.jobId, s.jobId));
    const isNew = !plan;
    if (!plan)
      [plan] = await tx
        .insert(jobFloorPlans)
        .values({
          organizationId: s.organizationId,
          jobId: s.jobId,
          originalFilename: s.filename,
          storageKey: `${s.jobId}/${s.id}/plan.pdf`,
          status: "ready",
          pageCount: sheets.length,
          uploadedByUserId: s.userId,
        })
        .returning();
    const [last] = await tx
      .select({ pageNumber: jobFloors.pageNumber })
      .from(jobFloors)
      .where(eq(jobFloors.jobId, s.jobId))
      .orderBy(desc(jobFloors.pageNumber))
      .limit(1);
    const created = await tx
      .insert(jobFloors)
      .values(
        sheets.map((sheet, i) => ({
          ...sheet,
          organizationId: s.organizationId,
          jobId: s.jobId,
          floorPlanId: plan!.id,
          pageNumber: (last?.pageNumber ?? 0) + i + 1,
          status: "pending_review",
        })),
      )
      .returning({
        id: jobFloors.id,
        name: jobFloors.name,
        imageUrl: jobFloors.imageUrl,
        pageNumber: jobFloors.pageNumber,
      });
    if (!isNew)
      await tx
        .update(jobFloorPlans)
        .set({
          pageCount: (last?.pageNumber ?? 0) + sheets.length,
          updatedAt: new Date(),
        })
        .where(eq(jobFloorPlans.id, plan!.id));
    return created;
  });
  await saveSession({ ...s, status: "ready", floors });
  await unlink(path.join(sessionDir(s.id), "upload.pdf"));
}
/** Drawings: every page becomes a sheet at the end of the folder. No review or detection. */
async function addToDrawingSet(
  s: UploadSession,
  setId: string,
  sheets: Awaited<ReturnType<typeof renderUploadPdf>>,
) {
  await db.transaction(async (tx) => {
    const [set] = await tx
      .select({ id: jobDrawingSets.id })
      .from(jobDrawingSets)
      .where(
        and(
          eq(jobDrawingSets.id, setId),
          eq(jobDrawingSets.jobId, s.jobId),
          eq(jobDrawingSets.organizationId, s.organizationId),
        ),
      )
      .for("update");
    if (!set) throw new Error("Drawing folder no longer available");
    const [last] = await tx
      .select({ sortOrder: jobDrawingSheets.sortOrder })
      .from(jobDrawingSheets)
      .where(eq(jobDrawingSheets.setId, setId))
      .orderBy(desc(jobDrawingSheets.sortOrder))
      .limit(1);
    if (sheets.length)
      await tx.insert(jobDrawingSheets).values(
        sheets.map((sheet, index) => ({
          organizationId: s.organizationId,
          jobId: s.jobId,
          setId,
          name: sheet.name.slice(0, 255),
          imageUrl: sheet.imageUrl,
          width: sheet.width,
          height: sheet.height,
          sortOrder: (last?.sortOrder ?? 0) + index + 1,
          sourceFilename: s.filename.slice(0, 255),
          uploadedByUserId: s.userId,
        })),
      );
    await tx
      .update(jobDrawingSets)
      .set({ updatedAt: new Date() })
      .where(eq(jobDrawingSets.id, setId));
  });
}

const id = process.argv[2];
if (!id) throw new Error("Upload id required");
let s: UploadSession | undefined;
try {
  s = await readSession(id);
  await run(s);
} catch (error) {
  console.error("[pdf-upload]", id, error);
  if (s)
    await saveSession({
      ...s,
      status: "error",
      error: error instanceof Error ? error.message : "PDF processing failed",
    });
  process.exitCode = 1;
} finally {
  await releaseWorker(id);
  // postgres clients otherwise keep the short-lived renderer alive.
  process.exit(process.exitCode ?? 0);
}
