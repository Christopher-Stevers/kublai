import { TRPCError } from "@trpc/server";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import { assertCanDeleteCoreRecords } from "~/server/auth/permissions";
import {
  entitySyncMutations,
  jobs,
  materialLists,
  quotes,
  locations,
  users,
} from "~/server/db/schema";

const entitySyncMutationInput = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("createJob"),
    clientMutationId: z.string().min(1).max(255),
    localJobId: z.string().min(1).max(255),
    name: z.string().min(1),
    locationId: z.string().uuid().nullable().optional(),
    queuedAt: z.string(),
  }),
  z.object({
    type: z.literal("updateJob"),
    clientMutationId: z.string().min(1).max(255),
    jobId: z.string().min(1).max(255),
    name: z.string().min(1).nullable().optional(),
    locationId: z.string().uuid().nullable().optional(),
    poNumber: z.string().nullable().optional(),
    foremanName: z.string().nullable().optional(),
    queuedAt: z.string(),
  }),
  z.object({
    type: z.literal("createMaterialList"),
    clientMutationId: z.string().min(1).max(255),
    localMaterialListId: z.string().min(1).max(255),
    localJobId: z.string().uuid(),
    name: z.string().min(1).optional(),
    queuedAt: z.string(),
  }),
  z.object({
    type: z.literal("deleteJob"),
    clientMutationId: z.string().min(1).max(255),
    jobId: z.string().min(1).max(255),
    queuedAt: z.string(),
  }),
  z.object({
    type: z.literal("deleteMaterialList"),
    clientMutationId: z.string().min(1).max(255),
    materialListId: z.string().min(1).max(255),
    jobId: z.string().min(1).max(255),
    queuedAt: z.string(),
  }),
]);

function isUuid(value: string | null | undefined) {
  return (
    !!value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

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
        poNumber: jobs.poNumber,
        locationId: jobs.locationId,
        foremanName: jobs.foremanName,
        status: jobs.status,
        createdAt: jobs.createdAt,
        location: {
          id: locations.id,
          name: locations.name,
          address1: locations.address1,
          address2: locations.address2,
          city: locations.city,
          region: locations.region,
          postalCode: locations.postalCode,
          country: locations.country,
        },
        foreman: {
          id: users.id,
          name: sql<string>`coalesce(${jobs.foremanName}, ${users.name})`,
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

  syncEntityMutations: hasDashboardAccess
    .input(z.object({ mutations: z.array(entitySyncMutationInput).max(100) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const applied: Array<{
        clientMutationId: string;
        type: string;
        localEntityId: string;
        serverEntityId: string | null;
        duplicate?: boolean;
      }> = [];
      const failed: Array<{
        clientMutationId: string;
        message: string;
        permanent: boolean;
      }> = [];

      for (const mutation of input.mutations) {
        try {
          const existing = await ctx.db
            .select({
              serverEntityId: entitySyncMutations.serverEntityId,
              entityType: entitySyncMutations.entityType,
            })
            .from(entitySyncMutations)
            .where(
              and(
                eq(entitySyncMutations.organizationId, ctx.user.organizationId),
                eq(
                  entitySyncMutations.clientMutationId,
                  mutation.clientMutationId,
                ),
              ),
            )
            .limit(1);

          if (existing[0]) {
            let serverEntityId = existing[0].serverEntityId;

            // Idempotency rows can outlive the entity they originally pointed
            // at (for example, an offline-created job later deleted while a
            // browser still has the create mutation cached). Returning that
            // stale server id teaches the client to navigate to a job that no
            // longer exists, which shows up as repeated job.getJob NOT_FOUND
            // failures after sync. If a duplicate createJob points at a missing
            // row, repair the idempotency mapping by creating the job again and
            // returning the fresh id.
            if (mutation.type === "createJob" && serverEntityId) {
              const [existingJob] = await ctx.db
                .select({ id: jobs.id })
                .from(jobs)
                .where(
                  and(
                    eq(jobs.id, serverEntityId),
                    eq(jobs.organizationId, ctx.user.organizationId),
                  ),
                )
                .limit(1);

              if (!existingJob) {
                const [job] = await ctx.db
                  .insert(jobs)
                  .values({
                    organizationId: ctx.user.organizationId,
                    name: mutation.name,
                    locationId: isUuid(mutation.locationId)
                      ? mutation.locationId
                      : null,
                    foremanUserId: ctx.userId,
                    createdByUserId: ctx.userId,
                    status: "draft",
                  })
                  .returning();
                if (!job) throw new Error("Failed to recreate job");

                serverEntityId = job.id;
                await ctx.db
                  .update(entitySyncMutations)
                  .set({ serverEntityId, payload: mutation })
                  .where(
                    and(
                      eq(
                        entitySyncMutations.organizationId,
                        ctx.user.organizationId,
                      ),
                      eq(
                        entitySyncMutations.clientMutationId,
                        mutation.clientMutationId,
                      ),
                    ),
                  );
              }
            }

            applied.push({
              clientMutationId: mutation.clientMutationId,
              type: mutation.type,
              localEntityId:
                mutation.type === "createJob"
                  ? mutation.localJobId
                  : mutation.type === "createMaterialList"
                    ? mutation.localMaterialListId
                    : mutation.type === "deleteMaterialList"
                      ? mutation.materialListId
                      : mutation.jobId,
              serverEntityId,
              duplicate: true,
            });
            continue;
          }

          const result = await ctx.db.transaction(async (tx) => {
            let entityType: "job" | "materialList";
            let clientEntityId: string;
            let serverEntityId: string | null = null;

            if (mutation.type === "createJob") {
              entityType = "job";
              clientEntityId = mutation.localJobId;
              const [job] = await tx
                .insert(jobs)
                .values({
                  organizationId: ctx.user.organizationId!,
                  name: mutation.name,
                  locationId: isUuid(mutation.locationId)
                    ? mutation.locationId
                    : null,
                  foremanUserId: ctx.userId,
                  createdByUserId: ctx.userId,
                  status: "draft",
                })
                .returning();
              if (!job) throw new Error("Failed to create job");
              serverEntityId = job.id;
            } else if (mutation.type === "updateJob") {
              entityType = "job";
              clientEntityId = mutation.jobId;
              if (!isUuid(mutation.jobId))
                throw new Error("Update job requires server job id");
              const [job] = await tx
                .select({ id: jobs.id })
                .from(jobs)
                .where(
                  and(
                    eq(jobs.id, mutation.jobId),
                    eq(jobs.organizationId, ctx.user.organizationId!),
                  ),
                )
                .limit(1);
              if (!job) throw new Error("Job not found");
              await tx
                .update(jobs)
                .set({
                  name: mutation.name ?? undefined,
                  locationId: mutation.locationId ?? undefined,
                  poNumber: mutation.poNumber?.trim() || undefined,
                  foremanName: mutation.foremanName?.trim() || undefined,
                })
                .where(eq(jobs.id, mutation.jobId));
              serverEntityId = mutation.jobId;
            } else if (mutation.type === "createMaterialList") {
              entityType = "materialList";
              clientEntityId = mutation.localMaterialListId;
              const [job] = await tx
                .select({ id: jobs.id })
                .from(jobs)
                .where(
                  and(
                    eq(jobs.id, mutation.localJobId),
                    eq(jobs.organizationId, ctx.user.organizationId!),
                  ),
                )
                .limit(1);
              if (!job) throw new Error("Job not found");
              const [materialList] = await tx
                .insert(materialLists)
                .values({
                  organizationId: ctx.user.organizationId!,
                  jobId: mutation.localJobId,
                  name: mutation.name?.trim() || "Material List",
                  createdByUserId: ctx.userId,
                })
                .returning();
              if (!materialList)
                throw new Error("Failed to create material list");
              const [quote] = await tx
                .insert(quotes)
                .values({
                  organizationId: ctx.user.organizationId!,
                  materialListId: materialList.id,
                  jobId: mutation.localJobId,
                  createdByUserId: ctx.userId,
                  subtotalMaterials: "0",
                  total: "0",
                })
                .returning();
              if (!quote) throw new Error("Failed to create quote");
              await tx
                .update(materialLists)
                .set({ quoteId: quote.id })
                .where(eq(materialLists.id, materialList.id));
              serverEntityId = materialList.id;
            } else if (mutation.type === "deleteMaterialList") {
              entityType = "materialList";
              clientEntityId = mutation.materialListId;
              if (isUuid(mutation.materialListId)) {
                await tx
                  .delete(materialLists)
                  .where(
                    and(
                      eq(materialLists.id, mutation.materialListId),
                      eq(
                        materialLists.organizationId,
                        ctx.user.organizationId!,
                      ),
                    ),
                  );
                serverEntityId = mutation.materialListId;
              }
            } else {
              entityType = "job";
              clientEntityId = mutation.jobId;
              if (isUuid(mutation.jobId)) {
                await tx
                  .update(users)
                  .set({ currentJobId: null })
                  .where(eq(users.currentJobId, mutation.jobId));
                await tx
                  .delete(jobs)
                  .where(
                    and(
                      eq(jobs.id, mutation.jobId),
                      eq(jobs.organizationId, ctx.user.organizationId!),
                    ),
                  );
                serverEntityId = mutation.jobId;
              }
            }

            await tx.insert(entitySyncMutations).values({
              organizationId: ctx.user.organizationId!,
              userId: ctx.userId,
              clientMutationId: mutation.clientMutationId,
              mutationType: mutation.type,
              entityType,
              clientEntityId,
              serverEntityId,
              payload: mutation,
            });

            return { entityType, clientEntityId, serverEntityId };
          });

          applied.push({
            clientMutationId: mutation.clientMutationId,
            type: mutation.type,
            localEntityId: result.clientEntityId,
            serverEntityId: result.serverEntityId,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          failed.push({
            clientMutationId: mutation.clientMutationId,
            message,
            permanent:
              message.includes("requires server") ||
              message.includes("not found") ||
              message.includes("Failed to create"),
          });
        }
      }

      return { applied, failed };
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
          poNumber: jobs.poNumber,
          locationId: jobs.locationId,
          foremanUserId: jobs.foremanUserId,
          foremanName: jobs.foremanName,
          status: jobs.status,
          createdAt: jobs.createdAt,
          location: {
            id: locations.id,
            name: locations.name,
            address1: locations.address1,
            address2: locations.address2,
            city: locations.city,
            region: locations.region,
            postalCode: locations.postalCode,
            country: locations.country,
          },
          foreman: {
            id: users.id,
            name: sql<string>`coalesce(${jobs.foremanName}, ${users.name})`,
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
        poNumber: z.string().trim().nullable().optional(),
        foremanUserId: z.string().optional(),
        foremanName: z.string().trim().nullable().optional(),
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
      if (updates.foremanName !== undefined) {
        updates.foremanName = updates.foremanName?.trim() || null;
      }
      if (updates.poNumber !== undefined) {
        updates.poNumber = updates.poNumber?.trim() || null;
      }

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
   * Delete a job and its related material lists, quotes, and orders.
   */
  deleteJob: hasDashboardAccess
    .input(z.object({ jobId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertCanDeleteCoreRecords(ctx.user);

      if (!ctx.user.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to an organization",
        });
      }

      const [existingJob] = await ctx.db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.id, input.jobId),
            eq(jobs.organizationId, ctx.user.organizationId),
          ),
        )
        .limit(1);

      if (!existingJob) {
        // Offline sync may replay a queued delete after the server has already
        // removed the job. Treat deletes as idempotent so the outbox can drain
        // without surfacing a spurious tRPC failure to the dev/error log.
        return { success: true };
      }

      await ctx.db
        .update(users)
        .set({ currentJobId: null })
        .where(eq(users.currentJobId, input.jobId));

      await ctx.db.delete(jobs).where(eq(jobs.id, input.jobId));

      return { success: true };
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
