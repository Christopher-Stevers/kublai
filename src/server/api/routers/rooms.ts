import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";

import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import { getUserPermissions } from "~/server/auth/permissions";
import { jobFloorPlans, jobFloors, jobRooms, jobs } from "~/server/db/schema";
import {
  beginDetectJob,
  getDetectJob,
  growRoomOnFloor,
  runAiDetectAllRooms,
} from "~/server/rooms/detect-job";
import { JOB_ROOM_FILE_PUBLIC_PREFIX } from "~/server/rooms/storage";

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
    points: z.array(roomPointSchema).min(3).max(40),
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
      const organizationId = ctx.user.organizationId!;
      const canManage = getUserPermissions(ctx.user).isManagingAccount;

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

      const roomsByFloor = new Map<string, typeof rooms>();
      for (const room of rooms) {
        if (!canManage && !room.confirmed) continue;
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
          rooms: roomsByFloor.get(floor.id) ?? [],
        })),
      };
    }),

  renameFloor: hasDashboardAccess
    .input(
      z.object({
        floorId: z.string().uuid(),
        name: z.string().trim().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!getUserPermissions(ctx.user).isManagingAccount) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = ctx.user.organizationId!;
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
    .input(z.object({ floorId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!getUserPermissions(ctx.user).isManagingAccount) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = ctx.user.organizationId!;
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
      const now = new Date();
      await ctx.db
        .update(jobFloors)
        .set({ status: "confirmed", confirmedAt: now, updatedAt: now })
        .where(eq(jobFloors.id, floor.id));
      await ctx.db
        .update(jobRooms)
        .set({ confirmed: true, updatedAt: now })
        .where(eq(jobRooms.floorId, floor.id));
      return { ok: true };
    }),

  deleteFloor: hasDashboardAccess
    .input(z.object({ floorId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!getUserPermissions(ctx.user).isManagingAccount) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = ctx.user.organizationId!;
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
      await ctx.db.delete(jobFloors).where(eq(jobFloors.id, floor.id));
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
      if (!getUserPermissions(ctx.user).isManagingAccount) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = ctx.user.organizationId!;
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
      const [room] = await ctx.db
        .insert(jobRooms)
        .values({
          organizationId,
          jobId: floor.jobId,
          floorId: floor.id,
          name: input.name,
          source: "manual",
          confirmed: floor.status === "confirmed",
          shape: input.shape,
          sortOrder: 999,
        })
        .returning();
      return room;
    }),

  updateRoom: hasDashboardAccess
    .input(
      z.object({
        roomId: z.string().uuid(),
        name: z.string().trim().min(1).max(255).optional(),
        shape: roomShapeSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!getUserPermissions(ctx.user).isManagingAccount) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = ctx.user.organizationId!;
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
      await ctx.db
        .update(jobRooms)
        .set({
          ...(input.name ? { name: input.name } : {}),
          ...(input.shape ? { shape: input.shape } : {}),
          updatedAt: new Date(),
        })
        .where(eq(jobRooms.id, room.id));
      return { ok: true };
    }),

  deleteRoom: hasDashboardAccess
    .input(z.object({ roomId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!getUserPermissions(ctx.user).isManagingAccount) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = ctx.user.organizationId!;
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
      await ctx.db.delete(jobRooms).where(eq(jobRooms.id, room.id));
      return { ok: true };
    }),

  deleteAllRooms: hasDashboardAccess
    .input(z.object({ floorId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!getUserPermissions(ctx.user).isManagingAccount) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = ctx.user.organizationId!;
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
        .delete(jobRooms)
        .where(
          and(
            eq(jobRooms.floorId, floor.id),
            eq(jobRooms.organizationId, organizationId),
          ),
        );
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
      if (!getUserPermissions(ctx.user).isManagingAccount) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = ctx.user.organizationId!;
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

  detectRoomsAi: hasDashboardAccess
    .input(z.object({ floorId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!getUserPermissions(ctx.user).isManagingAccount) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = ctx.user.organizationId!;
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

      if (!beginDetectJob(floor.id)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "AI is already detecting rooms on this floor",
        });
      }

      console.log("[rooms.detectRoomsAi] started", floor.id);
      const run = () =>
        runAiDetectAllRooms({
          floorId: floor.id,
          organizationId,
          jobId: floor.jobId,
          imageUrl: floor.imageUrl,
          floorStatus: floor.status,
          pageNumber: floor.pageNumber,
        }).catch((error) => {
          console.error(
            "[rooms.detectRoomsAi] background failed",
            error instanceof Error ? error.message : error,
          );
        });
      try {
        after(run);
      } catch {
        setTimeout(run, 0);
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
      if (!getUserPermissions(ctx.user).isManagingAccount) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const organizationId = ctx.user.organizationId!;
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

  detectRoomsAiStatus: hasDashboardAccess
    .input(z.object({ floorId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!getUserPermissions(ctx.user).isManagingAccount) {
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
                eq(jobFloors.organizationId, ctx.user.organizationId!),
              ),
            )
            .limit(1)
        )[0],
        ctx.user.organizationId!,
      );
      return (
        getDetectJob(input.floorId) ?? {
          floorId: input.floorId,
          status: "idle" as const,
          startedAt: 0,
          log: [],
        }
      );
    }),
});
