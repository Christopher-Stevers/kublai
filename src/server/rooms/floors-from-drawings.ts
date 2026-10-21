import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { db as database } from "~/server/db";
import {
  jobDrawingSets,
  jobDrawingSheets,
  jobFloorPlans,
  jobFloors,
} from "~/server/db/schema";
import { enqueueDetectJobs } from "./detect-job";
import { JOB_ROOM_FILE_PUBLIC_PREFIX } from "./storage";

/**
 * Rooms floors are drawings chosen from the Drawings card. A floor shares the
 * sheet's stored page image (and the PDF and zoom tiles beside it), so nothing
 * is uploaded or copied twice; detection reads the same source PDF page.
 */
type Db = typeof database;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Only uploaded sheets have the stored page and PDF that detection reads. */
export function roomSourceImage(imageUrl: string, jobId: string) {
  const match = new RegExp(
    `^${JOB_ROOM_FILE_PUBLIC_PREFIX}/(${UUID})/(${UUID})/floor-\\d+\\.webp$`,
    "i",
  ).exec(imageUrl);
  if (match?.[1]?.toLowerCase() !== jobId.toLowerCase()) return null;
  return { pdfKey: `${match[1]}/${match[2]}/plan.pdf` };
}

export async function drawingChoices(
  db: Db,
  input: { jobId: string; organizationId: string },
) {
  const rows = await db
    .select({
      setId: jobDrawingSets.id,
      setName: jobDrawingSets.name,
      id: jobDrawingSheets.id,
      name: jobDrawingSheets.name,
      imageUrl: jobDrawingSheets.imageUrl,
      width: jobDrawingSheets.width,
      height: jobDrawingSheets.height,
    })
    .from(jobDrawingSheets)
    .innerJoin(jobDrawingSets, eq(jobDrawingSets.id, jobDrawingSheets.setId))
    .where(
      and(
        eq(jobDrawingSheets.jobId, input.jobId),
        eq(jobDrawingSheets.organizationId, input.organizationId),
        isNull(jobDrawingSets.documentVersionId),
      ),
    )
    .orderBy(
      asc(jobDrawingSets.name),
      asc(jobDrawingSets.createdAt),
      asc(jobDrawingSheets.sortOrder),
    );
  const floors = await db
    .select({ id: jobFloors.id, imageUrl: jobFloors.imageUrl })
    .from(jobFloors)
    .where(
      and(
        eq(jobFloors.jobId, input.jobId),
        eq(jobFloors.organizationId, input.organizationId),
      ),
    );
  const floorFor = new Map(floors.map((floor) => [floor.imageUrl, floor.id]));
  const sets = new Map<
    string,
    {
      id: string;
      name: string;
      sheets: Array<{
        id: string;
        name: string;
        imageUrl: string;
        width: number;
        height: number;
        floorId: string | null;
      }>;
    }
  >();
  for (const row of rows) {
    if (!roomSourceImage(row.imageUrl, input.jobId)) continue;
    const set = sets.get(row.setId) ?? {
      id: row.setId,
      name: row.setName,
      sheets: [],
    };
    set.sheets.push({
      id: row.id,
      name: row.name,
      imageUrl: row.imageUrl,
      width: row.width,
      height: row.height,
      floorId: floorFor.get(row.imageUrl) ?? null,
    });
    sets.set(row.setId, set);
  }
  return { sets: [...sets.values()] };
}

/** Adds the chosen sheets as floors and queues room detection for them. */
export async function addFloorsFromDrawings(
  db: Db,
  input: {
    jobId: string;
    organizationId: string;
    userId: string | null;
    sheetIds: string[];
  },
) {
  return db.transaction(async (tx) => {
    // Same lock as upload confirmation and the detection queue.
    await tx.execute(sql`select pg_advisory_xact_lock(72491833)`);
    const job = await tx.execute(sql`
      select id from kublai_job
      where id = ${input.jobId}::uuid and "organizationId" = ${input.organizationId}::uuid
      for update
    `);
    if (!job.length) throw new TRPCError({ code: "NOT_FOUND" });
    const found = await tx
      .select({
        id: jobDrawingSheets.id,
        name: jobDrawingSheets.name,
        imageUrl: jobDrawingSheets.imageUrl,
        width: jobDrawingSheets.width,
        height: jobDrawingSheets.height,
        sourceFilename: jobDrawingSheets.sourceFilename,
      })
      .from(jobDrawingSheets)
      .innerJoin(jobDrawingSets, eq(jobDrawingSets.id, jobDrawingSheets.setId))
      .where(
        and(
          inArray(jobDrawingSheets.id, input.sheetIds),
          eq(jobDrawingSheets.jobId, input.jobId),
          eq(jobDrawingSheets.organizationId, input.organizationId),
          isNull(jobDrawingSets.documentVersionId),
        ),
      );
    const byId = new Map(found.map((sheet) => [sheet.id, sheet]));
    const sheets = [...new Set(input.sheetIds)].map((id) => {
      const sheet = byId.get(id);
      if (!sheet)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "A chosen drawing is no longer available.",
        });
      if (!roomSourceImage(sheet.imageUrl, input.jobId))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${sheet.name} can't be used for rooms. Upload its PDF to a Drawings folder.`,
        });
      return sheet;
    });
    // A sheet already on Rooms is skipped; Copy floor covers multi-floor sheets.
    const existing = new Map(
      (
        await tx
          .select({ id: jobFloors.id, imageUrl: jobFloors.imageUrl })
          .from(jobFloors)
          .where(
            and(
              eq(jobFloors.jobId, input.jobId),
              eq(jobFloors.organizationId, input.organizationId),
              inArray(
                jobFloors.imageUrl,
                sheets.map((sheet) => sheet.imageUrl),
              ),
            ),
          )
      ).map((floor) => [floor.imageUrl, floor.id]),
    );
    const added = sheets.filter((sheet) => !existing.has(sheet.imageUrl));
    if (!added.length)
      return {
        floorIds: [] as string[],
        existingFloorIds: [...existing.values()],
      };
    let [plan] = await tx
      .select()
      .from(jobFloorPlans)
      .where(eq(jobFloorPlans.jobId, input.jobId));
    if (!plan)
      [plan] = await tx
        .insert(jobFloorPlans)
        .values({
          organizationId: input.organizationId,
          jobId: input.jobId,
          originalFilename: (added[0]!.sourceFilename ?? added[0]!.name).slice(
            0,
            255,
          ),
          storageKey: roomSourceImage(added[0]!.imageUrl, input.jobId)!.pdfKey,
          status: "ready",
          pageCount: 0,
          uploadedByUserId: input.userId,
        })
        .returning();
    const [last] = await tx
      .select({ pageNumber: jobFloors.pageNumber })
      .from(jobFloors)
      .where(eq(jobFloors.floorPlanId, plan!.id))
      .orderBy(desc(jobFloors.pageNumber))
      .limit(1);
    const start = last?.pageNumber ?? 0;
    const created = await tx
      .insert(jobFloors)
      .values(
        added.map((sheet, index) => ({
          organizationId: input.organizationId,
          jobId: input.jobId,
          floorPlanId: plan!.id,
          pageNumber: start + index + 1,
          name: sheet.name.slice(0, 255),
          imageUrl: sheet.imageUrl,
          width: sheet.width,
          height: sheet.height,
          status: "detected",
        })),
      )
      .returning({ id: jobFloors.id });
    await tx
      .update(jobFloorPlans)
      .set({ pageCount: start + added.length, updatedAt: new Date() })
      .where(eq(jobFloorPlans.id, plan!.id));
    const floorIds = created.map((floor) => floor.id);
    // Adding and queueing commit together, as with uploads.
    await enqueueDetectJobs(floorIds, input.organizationId, tx);
    return { floorIds, existingFloorIds: [...existing.values()] };
  });
}
