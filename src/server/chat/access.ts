import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { jobs, users } from "./tables";
import { hasManagingSeat, userCan } from "~/server/auth/permissions";
import type { RequestUser } from "~/server/utils/get-request-identity";

export type ChatJob = {
  id: string;
  organizationId: string;
  name: string;
  createdByUserId: string | null;
  foremanUserId: string | null;
};
export function checkChatAccess(user: RequestUser | null, job: ChatJob | null) {
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (
    user.organizationAccessStatus !== "approved" ||
    !user.organizationId ||
    !userCan(user, "tab.dashboard")
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Approved organization and dashboard access are required.",
    });
  if (job?.organizationId !== user.organizationId)
    throw new TRPCError({ code: "NOT_FOUND", message: "Job not found." });
  return { user, job, canModerate: hasManagingSeat(user) };
}

/** Re-read permissions for every request and every stream poll, including stale sessions. */
export async function assertChatAccess(
  userId: string | null | undefined,
  jobId: string,
) {
  if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  const [[user], [job]] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).limit(1),
    db
      .select({
        id: jobs.id,
        organizationId: jobs.organizationId,
        name: jobs.name,
        createdByUserId: jobs.createdByUserId,
        foremanUserId: jobs.foremanUserId,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1),
  ]);
  return checkChatAccess(
    (user ?? null) as RequestUser | null,
    (job ?? null) as ChatJob | null,
  );
}
export type ChatAccess = Awaited<ReturnType<typeof assertChatAccess>>;

export function assertMessageOwner(
  access: ChatAccess,
  authorId: string | null,
) {
  if (authorId !== access.user.id && !access.canModerate)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You can only change your own messages.",
    });
}
