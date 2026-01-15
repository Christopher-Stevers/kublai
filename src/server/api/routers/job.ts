import { TRPCError } from "@trpc/server";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import {
  jobs,
  materialLists,
  locations,
  users,
  organizations,
} from "~/server/db/schema";

export const jobRouter = createTRPCRouter({
  /**
   * List all jobs for the organization
   */
  listJobs: hasDashboardAccess.query(async ({ ctx }) => {
    if (!ctx.user.organizationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "User must belong to an organization",
      });
    }

    const jobsList = await ctx.db
      .select({
        id: jobs.id,
        name: jobs.name,
        locationId: jobs.locationId,
        status: jobs.status,
        createdAt: jobs.createdAt,
        location: {
          id: locations.id,
          name: locations.name,
        },
        foreman: {
          id: users.id,
          name: users.name,
        },
        materialListCount: sql<number>`(
          SELECT COUNT(*)::int 
          FROM ${materialLists} 
          WHERE ${materialLists.jobId} = ${jobs.id}
            AND ${materialLists.organizationId} = ${ctx.user.organizationId}
        )`,
      })
      .from(jobs)
      .leftJoin(locations, eq(jobs.locationId, locations.id))
      .leftJoin(users, eq(jobs.foremanUserId, users.id))
      .where(eq(jobs.organizationId, ctx.user.organizationId))
      .orderBy(desc(jobs.createdAt));

    return jobsList;
  }),

  /**
   * Get a single job with material lists
   */
  getJob: hasDashboardAccess
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const [job] = await ctx.db
        .select({
          id: jobs.id,
          name: jobs.name,
          locationId: jobs.locationId,
          foremanUserId: jobs.foremanUserId,
          status: jobs.status,
          createdAt: jobs.createdAt,
          location: {
            id: locations.id,
            name: locations.name,
          },
          foreman: {
            id: users.id,
            name: users.name,
          },
        })
        .from(jobs)
        .leftJoin(locations, eq(jobs.locationId, locations.id))
        .leftJoin(users, eq(jobs.foremanUserId, users.id))
        .where(
          and(
            eq(jobs.id, input.jobId),
            eq(jobs.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      // Get material lists for this job
      const lists = await ctx.db
        .select({
          id: materialLists.id,
          name: materialLists.name,
          createdAt: materialLists.createdAt,
        })
        .from(materialLists)
        .where(
          and(
            eq(materialLists.jobId, input.jobId),
            eq(materialLists.organizationId, ctx.user.organizationId),
          ),
        )
        .orderBy(desc(materialLists.createdAt));

      return {
        ...job,
        materialLists: lists,
      };
    }),

  /**
   * Create a new job
   */
  createJob: hasDashboardAccess
    .input(
      z.object({
        name: z.string().min(1).optional(),
        locationId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const [job] = await ctx.db
        .insert(jobs)
        .values({
          organizationId: ctx.user.organizationId,
          name: input.name ?? "New Job",
          locationId: input.locationId ?? null,
          foremanUserId: ctx.userId,
          createdByUserId: ctx.userId,
          status: "draft",
        })
        .returning();

      if (!job) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create job",
        });
      }

      return job;
    }),

  /**
   * Update job details
   */
  updateJob: hasDashboardAccess
    .input(
      z.object({
        jobId: z.string().uuid(),
        name: z.string().min(1).optional(),
        locationId: z.string().uuid().nullable().optional(),
        foremanUserId: z.string().optional(),
        status: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const { jobId, ...updates } = input;

      // Verify job belongs to organization
      const [existingJob] = await ctx.db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!existingJob) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      const [updatedJob] = await ctx.db
        .update(jobs)
        .set(updates)
        .where(eq(jobs.id, jobId))
        .returning();

      return updatedJob;
    }),

  /**
   * Set user's current job
   */
  setCurrentJob: hasDashboardAccess
    .input(z.object({ jobId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      // Verify job belongs to organization
      const [job] = await ctx.db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.id, input.jobId),
            eq(jobs.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      // Update user's currentJobId
      await ctx.db
        .update(users)
        .set({ currentJobId: input.jobId })
        .where(eq(users.id, ctx.userId));

      return { success: true };
    }),

  /**
   * Get user's current job (auto-creates if none)
   */
  getCurrentJob: hasDashboardAccess.query(async ({ ctx }) => {
    if (!ctx.user.organizationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "User must belong to an organization",
      });
    }

    // Check if user has a current job
    if (ctx.user.currentJobId) {
      const [job] = await ctx.db
        .select({
          id: jobs.id,
          name: jobs.name,
          locationId: jobs.locationId,
          status: jobs.status,
        })
        .from(jobs)
        .where(
          and(
            eq(jobs.id, ctx.user.currentJobId),
            eq(jobs.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (job) {
        return job;
      }
    }

    // No current job or job not found - check if any jobs exist
    const [existingJob] = await ctx.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.organizationId, ctx.user.organizationId))
      .orderBy(desc(jobs.createdAt))
      .limit(1);

    if (existingJob) {
      // Set first job as current
      await ctx.db
        .update(users)
        .set({ currentJobId: existingJob.id })
        .where(eq(users.id, ctx.userId));

      const [job] = await ctx.db
        .select({
          id: jobs.id,
          name: jobs.name,
          locationId: jobs.locationId,
          status: jobs.status,
        })
        .from(jobs)
        .where(eq(jobs.id, existingJob.id))
        .limit(1);

      return job;
    }

    // No jobs exist - create one
    const [newJob] = await ctx.db
      .insert(jobs)
      .values({
        organizationId: ctx.user.organizationId,
        name: "New Job",
        foremanUserId: ctx.userId,
        createdByUserId: ctx.userId,
        status: "draft",
      })
      .returning();

    if (!newJob) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create job",
      });
    }

    // Set as current job
    await ctx.db
      .update(users)
      .set({ currentJobId: newJob.id })
      .where(eq(users.id, ctx.userId));

    return {
      id: newJob.id,
      name: newJob.name,
      locationId: newJob.locationId,
      status: newJob.status,
    };
  }),
});

