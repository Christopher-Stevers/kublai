import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getUserPermissions } from "~/server/auth/permissions";
import { db } from "~/server/db";
import {
  jobFloorPlans,
  jobFloors,
  jobRooms,
  jobs,
} from "~/server/db/schema";
import { processJobFloorPlanPdf } from "~/server/rooms/process-pdf";
import {
  getJobFloorPlanPdfKey,
  replaceJobFloorPlanFiles,
  validateJobFloorPlanPdf,
  writeJobRoomFile,
} from "~/server/rooms/storage";
import { ensureUser } from "~/server/utils/ensure-user";
import { getAgentBypassUser } from "~/server/utils/get-agent-bypass-user";
import { getDevBypassUser } from "~/server/utils/get-dev-bypass-user";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

async function getRequestUser(request: Request) {
  const { userId } = await auth();
  if (userId) return ensureUser(userId);
  const headers = request.headers;
  return (await getAgentBypassUser(headers)) ?? (await getDevBypassUser());
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!getUserPermissions(user).isManagingAccount) {
    return NextResponse.json(
      { error: "Foreman/managing accounts upload floor plans." },
      { status: 403 },
    );
  }

  const formData = await request.formData();
  const jobId = String(formData.get("jobId") ?? "");
  const file = formData.get("file");
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json({ error: "Job id required" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "PDF file required" }, { status: 400 });
  }
  const validationError = validateJobFloorPlanPdf(file);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const [job] = await db
    .select({ id: jobs.id, organizationId: jobs.organizationId })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job || job.organizationId !== user.organizationId) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const pdfBuffer = Buffer.from(await file.arrayBuffer());
  const storageKey = getJobFloorPlanPdfKey(jobId);

  await replaceJobFloorPlanFiles(jobId);
  await writeJobRoomFile(storageKey, pdfBuffer);

  const existing = await db
    .select({ id: jobFloorPlans.id })
    .from(jobFloorPlans)
    .where(eq(jobFloorPlans.jobId, jobId));
  if (existing.length > 0) {
    await db.delete(jobFloorPlans).where(eq(jobFloorPlans.jobId, jobId));
  }

  const [plan] = await db
    .insert(jobFloorPlans)
    .values({
      organizationId: user.organizationId,
      jobId,
      originalFilename: file.name || "floor-plan.pdf",
      storageKey,
      status: "processing",
      pageCount: 0,
      uploadedByUserId: user.id,
    })
    .returning();

  try {
    const floors = await processJobFloorPlanPdf(jobId, pdfBuffer);
    for (const floor of floors) {
      const [createdFloor] = await db
        .insert(jobFloors)
        .values({
          organizationId: user.organizationId,
          jobId,
          floorPlanId: plan!.id,
          pageNumber: floor.pageNumber,
          name: floor.name,
          imageUrl: floor.imageUrl,
          width: floor.width,
          height: floor.height,
          status: "detected",
        })
        .returning();
      if (floor.rooms.length > 0) {
        await db.insert(jobRooms).values(
          floor.rooms.map((room, index) => ({
            organizationId: user.organizationId!,
            jobId,
            floorId: createdFloor!.id,
            name: room.name,
            source: "auto",
            confirmed: false,
            shape: room.shape,
            sortOrder: index,
          })),
        );
      }
    }

    await db
      .update(jobFloorPlans)
      .set({
        status: "ready",
        pageCount: floors.length,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(jobFloorPlans.id, plan!.id));

    return NextResponse.json({
      ok: true,
      floorCount: floors.length,
      roomCount: floors.reduce((sum, floor) => sum + floor.rooms.length, 0),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not process PDF";
    await db
      .update(jobFloorPlans)
      .set({ status: "failed", error: message, updatedAt: new Date() })
      .where(eq(jobFloorPlans.id, plan!.id));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
