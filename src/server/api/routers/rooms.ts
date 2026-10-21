import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import { userCan } from "~/server/auth/permissions";
import {
  jobFloorPlans,
  jobFloors,
  jobRooms,
  jobs,
  roomDetectionFeedback,
  roomDetectionJobs,
} from "~/server/db/schema";
import {
  enqueueDetectJobs,
  getDetectJob,
  growRoomOnFloor,
} from "~/server/rooms/detect-job";
import type { DetectionTx } from "~/server/rooms/detect-queue";
import { dispatchDetectQueue } from "~/server/rooms/detect-worker-process";
import { roomEditFeedback } from "~/server/rooms/edit-feedback";
import {
  getSourcePageFromFloorImage,
  JOB_ROOM_FILE_PUBLIC_PREFIX,
} from "~/server/rooms/storage";

import { sourceDrawingHash } from "~/server/rooms/drawing-hash";
import { validReviewShape } from "~/server/rooms/review-memory";
import { RoomReviewSourceError } from "~/server/rooms/review-source";
import {
  addFloorsFromDrawings,
  drawingChoices,
} from "~/server/rooms/floors-from-drawings";

const roomPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

const roomShapeSchema = z.union([
  z.object({
    type: z.literal("bbox"),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0.005).max(1),
    h: z.number().min(0.005).max(1),
  }),
  z.object({
    type: z.literal("polygon"),
    points: z.array(roomPointSchema).min(3).max(400),
    holes: z
      .array(z.array(roomPointSchema).min(3).max(400))
      .max(100)
      .optional(),
  }),
]);

function assertJobOrg<T extends { organizationId: string }>(
  row: T | undefined,
  organizationId: string,
): T {
  if (!row || row.organizationId !== organizationId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  }
  return row;
}

function requireRow<T extends { organizationId: string }>(
  row: T | undefined,
  organizationId: string,
): T {
  return assertJobOrg(row, organizationId);
}

async function lockRoomEditFloor(
  tx: DetectionTx,
  floorId: string,
  organizationId: string,
) {
  // Match detection persistence order: queue lease → floor → individual rooms.
  await tx.execute(sql`select pg_advisory_xact_lock(72491833)`);
  const [run] = await tx
    .select({ runId: roomDetectionJobs.runId })
    .from(roomDetectionJobs)
    .where(
      and(
        eq(roomDetectionJobs.floorId, floorId),
        eq(roomDetectionJobs.organizationId, organizationId),
      ),
    )
    .for("update");
  const [floor] = await tx
    .select()
    .from(jobFloors)
    .where(
      and(
        eq(jobFloors.id, floorId),
        eq(jobFloors.organizationId, organizationId),
      ),
    )
    .for("update");
  if (!floor) throw new TRPCError({ code: "NOT_FOUND" });
  if (floor.status === "pending_review" || floor.status === "pending_upload")
    throw new TRPCError({
      code: "CONFLICT",
      message: "Confirm the drawing upload before editing rooms.",
    });
  return { floor, observedRunId: run?.runId ?? null };
}

function assertEditableRoom(room: { reviewStatus: string }) {
  if (room.reviewStatus === "superseded" || room.reviewStatus === "rejected")
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This room is no longer active. Reload the drawing before editing.",
    });
}

function editFeedback(input: Parameters<typeof roomEditFeedback>[0]) {
  try {
    return roomEditFeedback(input);
  } catch (error) {
    if (error instanceof RoomReviewSourceError)
      throw new TRPCError({ code: "CONFLICT", message: error.message });
    throw error;
  }
}

export const roomsRouter = createTRPCRouter({
  getJobRooms: hasDashboardAccess
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const organizationId = (ctx.user as { organizationId: string })
        .organizationId;
      const canManage =
        userCan(ctx.user as never, "rooms.review") ||
        userCan(ctx.user as never, "drawings.upload");

      const [job] = await ctx.db
        .select({ id: jobs.id, organizationId: jobs.organizationId })
        .from(jobs)
        .where(
          and(
            eq(jobs.id, input.jobId),
            eq(jobs.organizationId, organizationId),
          ),
        )
        .limit(1);
      assertJobOrg(job, organizationId);

      const [plan] = await ctx.db
        .select()
        .from(jobFloorPlans)
        .where(
          and(
            eq(jobFloorPlans.jobId, input.jobId),
            eq(jobFloorPlans.organizationId, organizationId),
          ),
        )
        .limit(1);

      const floors = plan
        ? await ctx.db
            .select()
            .from(jobFloors)
            .where(
              and(
                eq(jobFloors.floorPlanId, plan.id),
                eq(jobFloors.organizationId, organizationId),
              ),
            )
            .orderBy(asc(jobFloors.pageNumber))
        : [];

      const visibleFloors = floors.filter(
        (floor) =>
          floor.status !== "pending_review" &&
          floor.status !== "pending_upload",
      );

      const rooms = visibleFloors.length
        ? await ctx.db
            .select()
            .from(jobRooms)
            .where(
              and(
                eq(jobRooms.jobId, input.jobId),
                eq(jobRooms.organizationId, organizationId),
              ),
            )
            .orderBy(asc(jobRooms.sortOrder), asc(jobRooms.createdAt))
        : [];

      // One lightweight query for the whole overview; queued work keeps running
      // on the server even when no floor is open in the browser.
      const detections =
        canManage && visibleFloors.length
          ? await ctx.db
              .select({
                floorId: roomDetectionJobs.floorId,
                status: roomDetectionJobs.status,
                error: roomDetectionJobs.error,
                queuePosition: sql<
                  number | null
                >`case when ${roomDetectionJobs.status} = 'queued' then (
                select count(*)::int from kublai_room_detection_job queued
                where queued.status = 'queued' and
                  (queued."startedAt", queued."floorId") <=
                  (${roomDetectionJobs.startedAt}, ${roomDetectionJobs.floorId})
              ) else null end`,
              })
              .from(roomDetectionJobs)
              .where(
                and(
                  eq(roomDetectionJobs.organizationId, organizationId),
                  inArray(
                    roomDetectionJobs.floorId,
                    visibleFloors.map((floor) => floor.id),
                  ),
                ),
              )
          : [];
      const detectionByFloor = new Map(
        detections.map((detection) => [
          detection.floorId,
          {
            status: detection.status as "queued" | "running" | "done" | "error",
            error: detection.error,
            queuePosition: detection.queuePosition,
          },
        ]),
      );

      const roomsByFloor = new Map<string, typeof rooms>();
      for (const room of rooms) {
        if (
          room.reviewStatus === "rejected" ||
          room.reviewStatus === "superseded"
        )
          continue;
        const list = roomsByFloor.get(room.floorId) ?? [];
        list.push(room);
        roomsByFloor.set(room.floorId, list);
      }

      return {
        canManage,
        canUpload: userCan(ctx.user, "drawings.upload"),
        canDelete: userCan(ctx.user, "drawings.delete"),
        canEditNotes: userCan(ctx.user as never, "jobs.edit"),
        canRequestMaterial: userCan(ctx.user as never, "lists.edit"),
        plan: plan
          ? {
              id: plan.id,
              status: plan.status,
              originalFilename: plan.originalFilename,
              pageCount: plan.pageCount,
              error: plan.error,
            }
          : null,
        floors: visibleFloors.map((floor) => ({
          ...floor,
          detection: detectionByFloor.get(floor.id) ?? null,
          rooms: roomsByFloor.get(floor.id) ?? [],
        })),
      };
    }),

  updateNotes: hasDashboardAccess
    .input(
      z.object({
        roomId: z.string().uuid(),
        notes: z.string().max(10_000),
        expectedNotesRevision: z.number().int().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!userCan(ctx.user as never, "jobs.edit"))
        throw new TRPCError({ code: "FORBIDDEN" });
      const organizationId = (ctx.user as { organizationId: string })
        .organizationId;
      return ctx.db.transaction(async (tx) => {
        const [target] = await tx
          .select({ floorId: jobRooms.floorId })
          .from(jobRooms)
          .where(
            and(
              eq(jobRooms.id, input.roomId),
              eq(jobRooms.organizationId, organizationId),
            ),
          )
          .limit(1);
        if (!target) throw new TRPCError({ code: "NOT_FOUND" });
        // All room editors lock the floor before its rooms. Keep that order,
        // and prevent upload/visibility changes during this write.
        const [floor] = await tx
          .select()
          .from(jobFloors)
          .where(
            and(
              eq(jobFloors.id, target.floorId),
              eq(jobFloors.organizationId, organizationId),
            ),
          )
          .for("share");
        assertJobOrg(floor, organizationId);
        const [room] = await tx
          .select()
          .from(jobRooms)
          .where(
            and(
              eq(jobRooms.id, input.roomId),
              eq(jobRooms.organizationId, organizationId),
              eq(jobRooms.floorId, target.floorId),
            ),
          )
          .for("update");
        assertJobOrg(room, organizationId);
        if (
          !floor ||
          !room ||
          floor.status === "pending_review" ||
          floor.status === "pending_upload" ||
          room.reviewStatus === "rejected"
        )
          throw new TRPCError({ code: "NOT_FOUND" });
        assertEditableRoom(room);
        if (room.notesRevision !== input.expectedNotesRevision)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Someone changed these room notes. Review the latest notes before saving again.",
          });
        if (room.notes === input.notes)
          return { notes: room.notes, notesRevision: room.notesRevision };
        const notesRevision = room.notesRevision + 1;
        await tx
          .update(jobRooms)
          .set({
            notes: input.notes,
            notesRevision,
            updatedAt: new Date(
              Math.max(Date.now(), room.updatedAt.getTime() + 1),
            ),
          })
          .where(
            and(
              eq(jobRooms.id, room.id),
              eq(jobRooms.organizationId, organizationId),
            ),
          );
        return { notes: input.notes, notesRevision };
      });
    }),

  renameFloor: hasDashboardAccess
    .input(
      z.object({
        floorId: z.string().uuid(),
        name: z.string().trim().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!userCan(ctx.user as never, "drawings.upload")) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = (ctx.user as { organizationId: string })
        .organizationId;
      const floor = requireRow(
        (
          await ctx.db
            .select()
            .from(jobFloors)
            .where(
              and(
                eq(jobFloors.id, input.floorId),
                eq(jobFloors.organizationId, organizationId),
              ),
            )
            .limit(1)
        )[0],
        organizationId,
      );
      await ctx.db
        .update(jobFloors)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(jobFloors.id, floor.id));
      return { ok: true };
    }),

  deleteFloor: hasDashboardAccess
    .input(z.object({ floorId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!userCan(ctx.user as never, "drawings.delete")) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = (ctx.user as { organizationId: string })
        .organizationId;
      await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(72491833)`);
        const [active] = await tx
          .select()
          .from(roomDetectionJobs)
          .where(
            and(
              eq(roomDetectionJobs.floorId, input.floorId),
              eq(roomDetectionJobs.organizationId, organizationId),
            ),
          )
          .for("update");
        if (active?.status === "running" || active?.status === "queued")
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Wait for room detection to finish before deleting this floor.",
          });
        const [floor] = await tx
          .select()
          .from(jobFloors)
          .where(
            and(
              eq(jobFloors.id, input.floorId),
              eq(jobFloors.organizationId, organizationId),
            ),
          )
          .for("update");
        if (!floor) throw new TRPCError({ code: "NOT_FOUND" });
        await tx.delete(jobFloors).where(eq(jobFloors.id, floor.id));
      });
      return { ok: true };
    }),

  /**
   * Copies a floor and its room outlines, for drawings that cover several
   * floors. The copy shares the drawing image; room notes start empty because
   * they belong to the real floor.
   */
  copyFloor: hasDashboardAccess
    .input(z.object({ floorId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!userCan(ctx.user as never, "drawings.upload")) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = (ctx.user as { organizationId: string })
        .organizationId;
      return ctx.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(72491833)`);
        const [active] = await tx
          .select({ status: roomDetectionJobs.status })
          .from(roomDetectionJobs)
          .where(
            and(
              eq(roomDetectionJobs.floorId, input.floorId),
              eq(roomDetectionJobs.organizationId, organizationId),
            ),
          );
        if (active?.status === "running" || active?.status === "queued")
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Wait for room detection to finish before copying this floor.",
          });
        const [floor] = await tx
          .select()
          .from(jobFloors)
          .where(
            and(
              eq(jobFloors.id, input.floorId),
              eq(jobFloors.organizationId, organizationId),
            ),
          )
          .for("update");
        if (!floor) throw new TRPCError({ code: "NOT_FOUND" });
        // Page numbers are unique per drawing set and order the floors; the
        // copy goes last. Detection reads the source page from the image.
        const [last] = await tx
          .select({ page: sql<number>`max(${jobFloors.pageNumber})` })
          .from(jobFloors)
          .where(eq(jobFloors.floorPlanId, floor.floorPlanId));
        const suffix = " (copy)";
        const [copy] = await tx
          .insert(jobFloors)
          .values({
            organizationId,
            jobId: floor.jobId,
            floorPlanId: floor.floorPlanId,
            pageNumber: Number(last?.page ?? floor.pageNumber) + 1,
            name: floor.name.slice(0, 255 - suffix.length) + suffix,
            imageUrl: floor.imageUrl,
            width: floor.width,
            height: floor.height,
            status: floor.status,
            confirmedAt: floor.confirmedAt,
            completenessReviewedAt: floor.completenessReviewedAt,
          })
          .returning({ id: jobFloors.id });
        const rooms = await tx
          .select()
          .from(jobRooms)
          .where(
            and(
              eq(jobRooms.floorId, floor.id),
              eq(jobRooms.organizationId, organizationId),
            ),
          );
        if (rooms.length)
          await tx.insert(jobRooms).values(
            rooms.map((room) => ({
              organizationId,
              jobId: room.jobId,
              floorId: copy!.id,
              name: room.name,
              source: room.source,
              confirmed: room.confirmed,
              reviewStatus: room.reviewStatus,
              detection: room.detection,
              shape: room.shape,
              sortOrder: room.sortOrder,
            })),
          );
        return { floorId: copy!.id, roomCount: rooms.length };
      });
    }),

  addRoom: hasDashboardAccess
    .input(
      z.object({
        floorId: z.string().uuid(),
        name: z.string().trim().min(1).max(255),
        shape: roomShapeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!userCan(ctx.user as never, "rooms.review")) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = (ctx.user as { organizationId: string })
        .organizationId;
      const floor = requireRow(
        (
          await ctx.db
            .select()
            .from(jobFloors)
            .where(
              and(
                eq(jobFloors.id, input.floorId),
                eq(jobFloors.organizationId, organizationId),
              ),
            )
            .limit(1)
        )[0],
        organizationId,
      );
      return ctx.db.transaction(async (tx) => {
        const { floor: lockedFloor, observedRunId } = await lockRoomEditFloor(
          tx,
          floor.id,
          organizationId,
        );
        if (!validReviewShape(input.shape))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "The outline crosses itself or has invalid boundaries. Adjust it before saving.",
          });
        const drawingHash = await sourceDrawingHash(lockedFloor);
        const feedback = editFeedback({
          before: null,
          after: { name: input.name, shape: input.shape },
          detection: { basis: "human-added-space", requiresReview: false },
          source: {
            drawingHash,
            sourcePageNumber: getSourcePageFromFloorImage(lockedFloor.imageUrl),
          },
          observedRunId,
        })!;
        const [room] = await tx
          .insert(jobRooms)
          .values({
            organizationId,
            jobId: floor.jobId,
            floorId: floor.id,
            name: input.name,
            source: "manual",
            detection: feedback.detection,
            confirmed: false,
            reviewStatus: "pending",
            shape: input.shape,
            sortOrder: 999,
          })
          .returning();
        await tx.insert(roomDetectionFeedback).values({
          organizationId,
          jobId: floor.jobId,
          floorId: floor.id,
          roomId: room!.id,
          userId: (ctx.user as { id: string }).id,
          drawingKey: `${lockedFloor.imageUrl}:${lockedFloor.pageNumber}`,
          ...feedback,
        });
        await tx
          .update(jobFloors)
          .set({
            status: "detected",
            confirmedAt: null,
            completenessReviewedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(jobFloors.id, floor.id));
        return room;
      });
    }),

  updateRoom: hasDashboardAccess
    .input(
      z.object({
        roomId: z.string().uuid(),
        name: z.string().trim().min(1).max(255).optional(),
        shape: roomShapeSchema.optional(),
        expectedUpdatedAt: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!userCan(ctx.user as never, "rooms.review")) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = (ctx.user as { organizationId: string })
        .organizationId;
      const room = requireRow(
        (
          await ctx.db
            .select()
            .from(jobRooms)
            .where(
              and(
                eq(jobRooms.id, input.roomId),
                eq(jobRooms.organizationId, organizationId),
              ),
            )
            .limit(1)
        )[0],
        organizationId,
      );
      const updatedAt = await ctx.db.transaction(async (tx) => {
        const { floor, observedRunId } = await lockRoomEditFloor(
          tx,
          room.floorId,
          organizationId,
        );
        const [locked] = await tx
          .select()
          .from(jobRooms)
          .where(
            and(
              eq(jobRooms.id, room.id),
              eq(jobRooms.organizationId, organizationId),
            ),
          )
          .for("update");
        if (!locked) throw new TRPCError({ code: "NOT_FOUND" });
        assertEditableRoom(locked);
        if (
          input.expectedUpdatedAt !== undefined &&
          locked.updatedAt.getTime() !== input.expectedUpdatedAt
        )
          throw new TRPCError({
            code: "CONFLICT",
            message: "This outline changed. Reload it before editing.",
          });
        if (input.shape && !validReviewShape(input.shape))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "The outline crosses itself or has invalid boundaries. Adjust it before saving.",
          });

        const drawingHash = await sourceDrawingHash(floor);
        const feedback = editFeedback({
          before: { name: locked.name, shape: locked.shape },
          after: {
            name: input.name ?? locked.name,
            shape: input.shape ?? locked.shape,
          },
          detection: locked.detection,
          source: {
            drawingHash,
            sourcePageNumber: getSourcePageFromFloorImage(floor.imageUrl),
          },
          observedRunId,
        });
        if (!feedback) return locked.updatedAt.getTime();
        const detection = {
          ...feedback.detection,
          ...(feedback.decision === "corrected"
            ? { invalidGeometry: false, requiresReview: false }
            : {}),
        };
        await tx.insert(roomDetectionFeedback).values({
          organizationId,
          jobId: room.jobId,
          floorId: room.floorId,
          roomId: room.id,
          userId: (ctx.user as { id: string }).id,
          drawingKey: `${floor.imageUrl}:${floor.pageNumber}`,
          ...feedback,
          detection,
        });
        const updatedAt = new Date(
          Math.max(Date.now(), locked.updatedAt.getTime() + 1),
        );
        await tx
          .update(jobRooms)
          .set({
            ...(input.name ? { name: input.name } : {}),
            ...(feedback.decision === "corrected"
              ? { shape: input.shape, source: "manual" }
              : {}),
            detection,
            reviewStatus: "pending",
            confirmed: false,
            updatedAt,
          })
          .where(eq(jobRooms.id, room.id));
        await tx
          .update(jobFloors)
          .set({
            status: "detected",
            confirmedAt: null,
            completenessReviewedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(jobFloors.id, floor.id));
        return updatedAt.getTime();
      });
      return { ok: true, updatedAt };
    }),

  deleteRoom: hasDashboardAccess
    .input(
      z.object({
        roomId: z.string().uuid(),
        expectedUpdatedAt: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!userCan(ctx.user as never, "rooms.review")) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = (ctx.user as { organizationId: string })
        .organizationId;
      const room = requireRow(
        (
          await ctx.db
            .select()
            .from(jobRooms)
            .where(
              and(
                eq(jobRooms.id, input.roomId),
                eq(jobRooms.organizationId, organizationId),
              ),
            )
            .limit(1)
        )[0],
        organizationId,
      );
      await ctx.db.transaction(async (tx) => {
        const { floor, observedRunId } = await lockRoomEditFloor(
          tx,
          room.floorId,
          organizationId,
        );
        const [locked] = await tx
          .select()
          .from(jobRooms)
          .where(eq(jobRooms.id, room.id))
          .for("update");
        if (!locked) return;

        assertEditableRoom(locked);
        if (
          input.expectedUpdatedAt !== undefined &&
          locked.updatedAt.getTime() !== input.expectedUpdatedAt
        )
          throw new TRPCError({
            code: "CONFLICT",
            message: "This room changed. Reload it before deleting.",
          });
        const drawingHash = await sourceDrawingHash(floor);
        const feedback = editFeedback({
          before: { name: locked.name, shape: locked.shape },
          after: null,
          detection: locked.detection,
          source: {
            drawingHash,
            sourcePageNumber: getSourcePageFromFloorImage(floor.imageUrl),
          },
          observedRunId,
        })!;
        await tx.insert(roomDetectionFeedback).values({
          organizationId,
          jobId: room.jobId,
          floorId: room.floorId,
          roomId: room.id,
          userId: (ctx.user as { id: string }).id,
          drawingKey: `${floor.imageUrl}:${floor.pageNumber}`,
          ...feedback,
        });
        await tx.delete(jobRooms).where(eq(jobRooms.id, room.id));
        await tx
          .update(jobFloors)
          .set({
            status: "detected",
            confirmedAt: null,
            completenessReviewedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(jobFloors.id, floor.id));
      });
      return { ok: true };
    }),

  deleteAllRooms: hasDashboardAccess
    .input(z.object({ floorId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!userCan(ctx.user as never, "rooms.review")) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = (ctx.user as { organizationId: string })
        .organizationId;
      const floor = requireRow(
        (
          await ctx.db
            .select()
            .from(jobFloors)
            .where(
              and(
                eq(jobFloors.id, input.floorId),
                eq(jobFloors.organizationId, organizationId),
              ),
            )
            .limit(1)
        )[0],
        organizationId,
      );
      await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(72491833)`);
        const [active] = await tx
          .select()
          .from(roomDetectionJobs)
          .where(
            and(
              eq(roomDetectionJobs.floorId, input.floorId),
              eq(roomDetectionJobs.organizationId, organizationId),
            ),
          )
          .for("update");
        if (active?.status === "running" || active?.status === "queued")
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Wait for room detection to finish before deleting all rooms.",
          });
        const [locked] = await tx
          .select()
          .from(jobFloors)
          .where(
            and(
              eq(jobFloors.id, floor.id),
              eq(jobFloors.organizationId, organizationId),
            ),
          )
          .for("update");
        if (!locked) throw new TRPCError({ code: "NOT_FOUND" });
        if (
          locked.status === "pending_review" ||
          locked.status === "pending_upload"
        )
          throw new TRPCError({
            code: "CONFLICT",
            message: "Confirm the drawing upload before editing rooms.",
          });
        const rooms = await tx
          .select()
          .from(jobRooms)
          .where(
            and(
              eq(jobRooms.floorId, floor.id),
              eq(jobRooms.organizationId, organizationId),
            ),
          )
          .for("update");
        const drawingHash = await sourceDrawingHash(locked);
        const activeRooms = rooms.filter(
          (room) =>
            room.reviewStatus !== "rejected" &&
            room.reviewStatus !== "superseded",
        );
        const feedback = activeRooms.map((room) => ({
          organizationId,
          jobId: room.jobId,
          floorId: room.floorId,
          roomId: room.id,
          userId: (ctx.user as { id: string }).id,
          drawingKey: `${locked.imageUrl}:${locked.pageNumber}`,
          ...editFeedback({
            before: { name: room.name, shape: room.shape },
            after: null,
            detection: room.detection,
            source: {
              drawingHash,
              sourcePageNumber: getSourcePageFromFloorImage(locked.imageUrl),
            },
            observedRunId: active?.runId ?? null,
            clear: true,
          })!,
        }));
        if (feedback.length)
          await tx.insert(roomDetectionFeedback).values(feedback);
        await tx
          .delete(jobRooms)
          .where(
            and(
              eq(jobRooms.floorId, floor.id),
              eq(jobRooms.organizationId, organizationId),
            ),
          );
        await tx
          .update(jobFloors)
          .set({
            status: "detected",
            confirmedAt: null,
            completenessReviewedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(jobFloors.id, floor.id));
      });
      return { ok: true };
    }),

  growRoom: hasDashboardAccess
    .input(
      z.object({
        floorId: z.string().uuid(),
        roomId: z.string().uuid().optional(),
        include: z.array(roomPointSchema).min(1).max(32),
        exclude: z.array(roomPointSchema).max(32),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!userCan(ctx.user as never, "rooms.review")) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = (ctx.user as { organizationId: string })
        .organizationId;
      const floor = requireRow(
        (
          await ctx.db
            .select()
            .from(jobFloors)
            .where(
              and(
                eq(jobFloors.id, input.floorId),
                eq(jobFloors.organizationId, organizationId),
              ),
            )
            .limit(1)
        )[0],
        organizationId,
      );
      const rooms = await ctx.db
        .select({ id: jobRooms.id, shape: jobRooms.shape })
        .from(jobRooms)
        .where(
          and(
            eq(jobRooms.floorId, floor.id),
            eq(jobRooms.organizationId, organizationId),
            inArray(jobRooms.reviewStatus, ["pending", "approved"]),
            or(
              eq(jobRooms.source, "manual"),
              eq(jobRooms.reviewStatus, "approved"),
            ),
          ),
        );
      const result = await growRoomOnFloor({
        source: {
          floorId: floor.id,
          jobId: floor.jobId,
          imageUrl: floor.imageUrl,
          pageNumber: floor.pageNumber,
        },
        include: input.include,
        exclude: input.exclude,
        otherRooms: rooms.filter((room) => room.id !== input.roomId),
      });
      if (!result) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No wall-bounded room was found at those points",
        });
      }
      return result;
    }),

  detectRooms: hasDashboardAccess
    .input(
      z.object({
        floorId: z.string().uuid(),
        /** Old clients may send legacy names; all interactive runs use reviewed space discovery. */
        method: z.enum(["standard", "hybrid", "complete"]).default("complete"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!userCan(ctx.user as never, "drawings.upload")) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = (ctx.user as { organizationId: string })
        .organizationId;
      await ctx.db.transaction(async (tx) => {
        // Share the queue admission lock with confirmation, copy and deletion.
        await tx.execute(sql`select pg_advisory_xact_lock(72491833)`);
        const [row] = await tx
          .select()
          .from(jobFloors)
          .where(
            and(
              eq(jobFloors.id, input.floorId),
              eq(jobFloors.organizationId, organizationId),
            ),
          );
        const floor = requireRow(row, organizationId);
        if (
          floor.status === "pending_review" ||
          !floor.imageUrl.startsWith(`${JOB_ROOM_FILE_PUBLIC_PREFIX}/`)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Confirm a sheet with a floor image before detecting rooms",
          });
        }
        await enqueueDetectJobs([floor.id], organizationId, tx);
      });
      // Dispatch is a best-effort nudge. Durable jobs are also picked up by the
      // startup/interval worker if this HTTP process or the connection ends.
      void dispatchDetectQueue().catch((error) =>
        console.error("[detect-queue]", error),
      );
      return { started: true as const };
    }),

  /** Drawings-folder sheets that can become Rooms floors. */
  drawingChoices: hasDashboardAccess
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!userCan(ctx.user as never, "drawings.view"))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have permission to access drawings",
        });
      // Both lookups are scoped to the organization; another job's ID
      // simply returns nothing.
      const organizationId = (ctx.user as { organizationId: string })
        .organizationId;
      return drawingChoices(ctx.db, { jobId: input.jobId, organizationId });
    }),

  /** Adds chosen drawings as floors (sharing their stored pages) and queues
   * room detection for each. */
  addFloorsFromDrawings: hasDashboardAccess
    .input(
      z.object({
        jobId: z.string().uuid(),
        sheetIds: z.array(z.string().uuid()).min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (
        !userCan(ctx.user as never, "drawings.view") ||
        !userCan(ctx.user as never, "drawings.upload")
      ) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const user = ctx.user as { organizationId: string; id?: string };
      const result = await addFloorsFromDrawings(ctx.db, {
        jobId: input.jobId,
        organizationId: user.organizationId,
        userId: user.id ?? null,
        sheetIds: input.sheetIds,
      });
      if (result.floorIds.length)
        void dispatchDetectQueue().catch((error) =>
          console.error("[detect-queue]", error),
        );
      return result;
    }),

  confirmDrawingUpload: hasDashboardAccess
    .input(
      z.object({
        jobId: z.string().uuid(),
        keepFloorIds: z.array(z.string().uuid()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!userCan(ctx.user as never, "drawings.upload")) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = (ctx.user as { organizationId: string })
        .organizationId;
      const keptFloorIds = await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(72491833)`);
        const matchingJobs = await tx.execute(sql`
          select id from kublai_job
          where id = ${input.jobId}::uuid and "organizationId" = ${organizationId}::uuid
        `);
        if (!matchingJobs.length) throw new TRPCError({ code: "NOT_FOUND" });
        const pending = await tx
          .select()
          .from(jobFloors)
          .where(
            and(
              eq(jobFloors.jobId, input.jobId),
              eq(jobFloors.organizationId, organizationId),
              eq(jobFloors.status, "pending_review"),
            ),
          )
          .orderBy(asc(jobFloors.pageNumber));
        const keep = new Set(input.keepFloorIds);
        const kept = pending.filter((floor) => keep.has(floor.id));
        const discarded = pending.filter((floor) => !keep.has(floor.id));
        if (
          kept.some(
            (floor) =>
              !floor.imageUrl.startsWith(`${JOB_ROOM_FILE_PUBLIC_PREFIX}/`),
          )
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Floor image is missing",
          });
        }
        if (discarded.length > 0) {
          await tx.delete(jobFloors).where(
            inArray(
              jobFloors.id,
              discarded.map((floor) => floor.id),
            ),
          );
        }
        if (kept.length > 0) {
          await tx
            .update(jobFloors)
            .set({ status: "detected", updatedAt: new Date() })
            .where(
              inArray(
                jobFloors.id,
                kept.map((floor) => floor.id),
              ),
            );
          // Acceptance and queueing are one commit: closing the app cannot
          // leave the later sheets saved but never submitted for detection.
          await enqueueDetectJobs(
            kept.map((floor) => floor.id),
            organizationId,
            tx,
          );
        }
        return kept.map((floor) => floor.id);
      });
      void dispatchDetectQueue().catch((error) =>
        console.error("[detect-queue]", error),
      );
      return { keptFloorIds };
    }),

  detectRoomsStatus: hasDashboardAccess
    .input(z.object({ floorId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (
        !(
          userCan(ctx.user as never, "rooms.review") ||
          userCan(ctx.user as never, "drawings.upload")
        )
      ) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      requireRow(
        (
          await ctx.db
            .select()
            .from(jobFloors)
            .where(
              and(
                eq(jobFloors.id, input.floorId),
                eq(
                  jobFloors.organizationId,
                  (ctx.user as { organizationId: string }).organizationId,
                ),
              ),
            )
            .limit(1)
        )[0],
        (ctx.user as { organizationId: string }).organizationId,
      );
      return (
        (await getDetectJob(input.floorId)) ?? {
          floorId: input.floorId,
          status: "idle" as const,
          startedAt: 0,
          log: [],
        }
      );
    }),
});
