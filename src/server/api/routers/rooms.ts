import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import { getUserPermissions } from "~/server/auth/permissions";
import {
  jobFloorPlans,
  jobFloors,
  jobRooms,
  jobs,
  roomDetectionFeedback,
  roomDetectionJobs,
} from "~/server/db/schema";
import {
  beginDetectJob,
  failDetectJob,
  getDetectJob,
  growRoomOnFloor,
} from "~/server/rooms/detect-job";
import { startDetectWorker } from "~/server/rooms/detect-worker-process";
import { JOB_ROOM_FILE_PUBLIC_PREFIX } from "~/server/rooms/storage";

import { sourceDrawingHash } from "~/server/rooms/drawing-hash";
import { validReviewShape } from "~/server/rooms/review-memory";
import { trainReviewRanker } from "~/server/rooms/review-model";
import type { RoomShape } from "~/lib/room-shape";

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

export const roomsRouter = createTRPCRouter({
  getJobRooms: hasDashboardAccess
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const organizationId = (ctx.user as { organizationId: string })
        .organizationId;
      const canManage = getUserPermissions(
        ctx.user as Parameters<typeof getUserPermissions>[0],
      ).isManagingAccount;

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

      const visibleFloors = canManage
        ? floors.filter((floor) => floor.status !== "pending_review")
        : floors.filter((floor) => floor.status === "confirmed");

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

      const feedback =
        canManage && rooms.length
          ? await ctx.db
              .select({
                roomId: roomDetectionFeedback.roomId,
                floorId: roomDetectionFeedback.floorId,
                decision: roomDetectionFeedback.decision,
                proposalShape: roomDetectionFeedback.proposalShape,
                detection: roomDetectionFeedback.detection,
              })
              .from(roomDetectionFeedback)
              .where(eq(roomDetectionFeedback.organizationId, organizationId))
              .orderBy(desc(roomDetectionFeedback.createdAt))
              .limit(2000)
          : [];
      const rankReview = trainReviewRanker(feedback);
      const roomsByFloor = new Map<string, typeof rooms>();
      for (const room of rooms) {
        if (!canManage && (!room.confirmed || room.reviewStatus !== "approved"))
          continue;
        const list = roomsByFloor.get(room.floorId) ?? [];
        list.push(room);
        roomsByFloor.set(room.floorId, list);
      }

      return {
        canManage,
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
          rooms: (roomsByFloor.get(floor.id) ?? []).map((room) => ({
            ...room,
            reviewPriority: rankReview(room.shape as RoomShape, room.detection),
          })),
        })),
      };
    }),

  reviewRoom: hasDashboardAccess
    .input(
      z.object({
        roomId: z.string().uuid(),
        decision: z.enum(["approved", "rejected", "pending"]),
        expectedUpdatedAt: z.number().int(),
        reason: z
          .enum([
            "not-space",
            "boundary",
            "merged",
            "split",
            "duplicate",
            "unspecified",
          ])
          .default("unspecified"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (
        !getUserPermissions(
          ctx.user as Parameters<typeof getUserPermissions>[0],
        ).isManagingAccount
      )
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
          );
        if (!target) throw new TRPCError({ code: "NOT_FOUND" });
        const [floor] = await tx
          .select()
          .from(jobFloors)
          .where(
            and(
              eq(jobFloors.id, target.floorId),
              eq(jobFloors.organizationId, organizationId),
            ),
          )
          .for("update");
        if (!floor) throw new TRPCError({ code: "NOT_FOUND" });
        const [room] = await tx
          .select()
          .from(jobRooms)
          .where(
            and(
              eq(jobRooms.id, input.roomId),
              eq(jobRooms.organizationId, organizationId),
            ),
          )
          .for("update");
        if (!room) throw new TRPCError({ code: "NOT_FOUND" });
        if (room.reviewStatus === "superseded")
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This proposal was superseded. Reload the floor before reviewing.",
          });
        if (room.updatedAt.getTime() !== input.expectedUpdatedAt)
          throw new TRPCError({
            code: "CONFLICT",
            message: "This outline changed. Reload it before reviewing.",
          });
        if (input.decision === "approved" && !validReviewShape(room.shape))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Fix this outline before approving it. Its boundaries are invalid.",
          });
        const drawingHash = await sourceDrawingHash(floor);
        const detection = {
          ...(room.detection as Record<string, unknown> | null),
          drawingHash,
        };
        await tx.insert(roomDetectionFeedback).values({
          organizationId,
          jobId: room.jobId,
          floorId: room.floorId,
          roomId: room.id,
          userId: (ctx.user as { id: string }).id,
          decision: input.decision,
          drawingKey: `${floor.imageUrl}:${floor.pageNumber}`,
          name: room.name,
          proposalShape: room.shape,
          detection:
            input.decision === "rejected"
              ? {
                  ...detection,
                  reviewReason: input.reason,
                }
              : detection,
        });
        await tx
          .update(jobRooms)
          .set({
            detection,
            reviewStatus: input.decision,
            confirmed: input.decision === "approved",
            updatedAt: new Date(
              Math.max(Date.now(), room.updatedAt.getTime() + 1),
            ),
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
        return { ok: true };
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
      if (
        !getUserPermissions(
          ctx.user as Parameters<typeof getUserPermissions>[0],
        ).isManagingAccount
      ) {
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

  confirmFloor: hasDashboardAccess
    .input(
      z.object({
        floorId: z.string().uuid(),
        completenessChecked: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (
        !getUserPermissions(
          ctx.user as Parameters<typeof getUserPermissions>[0],
        ).isManagingAccount
      ) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = (ctx.user as { organizationId: string })
        .organizationId;
      if (!input.completenessChecked)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Check the entire floor for missing rooms before confirming it.",
        });
      await ctx.db.transaction(async (tx) => {
        // Use the admission lock and the worker's job→floor→room lock order.
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
        if (active?.status === "running")
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Wait for room detection to finish before confirming this floor.",
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
        if (rooms.some((room) => room.reviewStatus === "pending"))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Approve or disapprove each proposed room before confirming this floor.",
          });
        if (!rooms.some((room) => room.reviewStatus === "approved"))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Add and approve at least one room before confirming this floor.",
          });
        const approved = rooms.filter(
          (room) => room.reviewStatus === "approved",
        );
        if (approved.some((room) => !validReviewShape(room.shape)))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Fix invalid room boundaries before confirming this floor.",
          });
        const drawingHash = await sourceDrawingHash(floor);
        await tx.insert(roomDetectionFeedback).values(
          approved.map((room) => ({
            organizationId,
            jobId: room.jobId,
            floorId: floor.id,
            roomId: room.id,
            userId: (ctx.user as { id: string }).id,
            decision: "approved",
            drawingKey: `${floor.imageUrl}:${floor.pageNumber}`,
            name: room.name,
            proposalShape: room.shape,
            detection: {
              ...(room.detection as Record<string, unknown> | null),
              drawingHash,
              completenessAttested: true,
            },
          })),
        );
        const now = new Date(
          Math.max(
            Date.now(),
            ...rooms.map((room) => room.updatedAt.getTime() + 1),
          ),
        );
        await tx
          .update(jobFloors)
          .set({
            status: "confirmed",
            confirmedAt: now,
            completenessReviewedAt: now,
            updatedAt: now,
          })
          .where(eq(jobFloors.id, floor.id));
        await tx
          .update(jobRooms)
          .set({
            confirmed: true,
            updatedAt: now,
            detection: sql`COALESCE(${jobRooms.detection},'{}'::jsonb) || ${JSON.stringify({ drawingHash, completenessAttested: true })}::jsonb`,
          })
          .where(
            and(
              eq(jobRooms.floorId, floor.id),
              eq(jobRooms.organizationId, organizationId),
              eq(jobRooms.reviewStatus, "approved"),
            ),
          );
      });
      return { ok: true };
    }),

  deleteFloor: hasDashboardAccess
    .input(z.object({ floorId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (
        !getUserPermissions(
          ctx.user as Parameters<typeof getUserPermissions>[0],
        ).isManagingAccount
      ) {
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
        if (active?.status === "running")
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

  addRoom: hasDashboardAccess
    .input(
      z.object({
        floorId: z.string().uuid(),
        name: z.string().trim().min(1).max(255),
        shape: roomShapeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (
        !getUserPermissions(
          ctx.user as Parameters<typeof getUserPermissions>[0],
        ).isManagingAccount
      ) {
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
        const [lockedFloor] = await tx
          .select()
          .from(jobFloors)
          .where(
            and(
              eq(jobFloors.id, floor.id),
              eq(jobFloors.organizationId, organizationId),
            ),
          )
          .for("update");
        if (!lockedFloor) throw new TRPCError({ code: "NOT_FOUND" });
        if (!validReviewShape(input.shape))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "The outline crosses itself or has invalid boundaries. Adjust it before saving.",
          });
        const drawingHash = await sourceDrawingHash(lockedFloor);
        const [room] = await tx
          .insert(jobRooms)
          .values({
            organizationId,
            jobId: floor.jobId,
            floorId: floor.id,
            name: input.name,
            source: "manual",
            detection: {
              basis: "human-added-space",
              requiresReview: true,
              drawingHash,
            },
            confirmed: false,
            reviewStatus: "pending",
            shape: input.shape,
            sortOrder: 999,
          })
          .returning();
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
      if (
        !getUserPermissions(
          ctx.user as Parameters<typeof getUserPermissions>[0],
        ).isManagingAccount
      ) {
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
        const [floor] = await tx
          .select()
          .from(jobFloors)
          .where(
            and(
              eq(jobFloors.id, room.floorId),
              eq(jobFloors.organizationId, organizationId),
            ),
          )
          .for("update");
        if (!floor) throw new TRPCError({ code: "NOT_FOUND" });
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
        if (locked.reviewStatus === "superseded")
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This proposal was superseded. Reload the floor before editing.",
          });
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
        const detection = {
          ...(locked.detection as Record<string, unknown> | null),
          drawingHash,
          ...(input.shape ? { invalidGeometry: false } : {}),
        };
        await tx.insert(roomDetectionFeedback).values({
          organizationId,
          jobId: room.jobId,
          floorId: room.floorId,
          roomId: room.id,
          userId: (ctx.user as { id: string }).id,
          decision: "corrected",
          drawingKey: `${floor.imageUrl}:${floor.pageNumber}`,
          name: locked.name,
          proposalShape: locked.shape,
          correctedShape: input.shape ?? locked.shape,
          detection,
        });
        const updatedAt = new Date(
          Math.max(Date.now(), locked.updatedAt.getTime() + 1),
        );
        await tx
          .update(jobRooms)
          .set({
            ...(input.name ? { name: input.name } : {}),
            ...(input.shape ? { shape: input.shape, source: "manual" } : {}),
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
    .input(z.object({ roomId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (
        !getUserPermissions(
          ctx.user as Parameters<typeof getUserPermissions>[0],
        ).isManagingAccount
      ) {
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
        const [floor] = await tx
          .select()
          .from(jobFloors)
          .where(
            and(
              eq(jobFloors.id, room.floorId),
              eq(jobFloors.organizationId, organizationId),
            ),
          )
          .for("update");
        if (!floor) throw new TRPCError({ code: "NOT_FOUND" });
        const [locked] = await tx
          .select()
          .from(jobRooms)
          .where(eq(jobRooms.id, room.id))
          .for("update");
        if (!locked) return;

        if (locked.source === "auto")
          await tx.insert(roomDetectionFeedback).values({
            organizationId,
            jobId: room.jobId,
            floorId: room.floorId,
            roomId: room.id,
            userId: (ctx.user as { id: string }).id,
            decision: "rejected",
            drawingKey: `${floor.imageUrl}:${floor.pageNumber}`,
            name: locked.name,
            proposalShape: locked.shape,
            detection: locked.detection,
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
      if (
        !getUserPermissions(
          ctx.user as Parameters<typeof getUserPermissions>[0],
        ).isManagingAccount
      ) {
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
        if (active?.status === "running")
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
      if (
        !getUserPermissions(
          ctx.user as Parameters<typeof getUserPermissions>[0],
        ).isManagingAccount
      ) {
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
      if (
        !getUserPermissions(
          ctx.user as Parameters<typeof getUserPermissions>[0],
        ).isManagingAccount
      ) {
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

      if (!floor.imageUrl.startsWith(`${JOB_ROOM_FILE_PUBLIC_PREFIX}/`)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Floor image is missing",
        });
      }

      const runId = await beginDetectJob(floor.id, organizationId);
      if (!runId) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Room detection is already running, or both processing slots are busy. Retry shortly",
        });
      }

      console.log("[rooms.detectRooms] started", floor.id, "complete");
      try {
        await startDetectWorker(floor.id, "complete", runId);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Room detection worker failed to start";
        await failDetectJob(floor.id, message, runId);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }

      return { started: true as const };
    }),

  confirmDrawingUpload: hasDashboardAccess
    .input(
      z.object({
        jobId: z.string().uuid(),
        keepFloorIds: z.array(z.string().uuid()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (
        !getUserPermissions(
          ctx.user as Parameters<typeof getUserPermissions>[0],
        ).isManagingAccount
      ) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = (ctx.user as { organizationId: string })
        .organizationId;
      const pending = await ctx.db
        .select()
        .from(jobFloors)
        .where(
          and(
            eq(jobFloors.jobId, input.jobId),
            eq(jobFloors.organizationId, organizationId),
            eq(jobFloors.status, "pending_review"),
          ),
        );
      const keep = new Set(input.keepFloorIds);
      const kept = pending.filter((floor) => keep.has(floor.id));
      const discarded = pending.filter((floor) => !keep.has(floor.id));
      if (discarded.length > 0) {
        await ctx.db.delete(jobFloors).where(
          inArray(
            jobFloors.id,
            discarded.map((floor) => floor.id),
          ),
        );
      }
      if (kept.length > 0) {
        await ctx.db
          .update(jobFloors)
          .set({ status: "detected", updatedAt: new Date() })
          .where(
            inArray(
              jobFloors.id,
              kept.map((floor) => floor.id),
            ),
          );
      }
      return { keptFloorIds: kept.map((floor) => floor.id) };
    }),

  detectRoomsStatus: hasDashboardAccess
    .input(z.object({ floorId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (
        !getUserPermissions(
          ctx.user as Parameters<typeof getUserPermissions>[0],
        ).isManagingAccount
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
