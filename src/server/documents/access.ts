import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { hasManagingSeat, userCan } from "~/server/auth/permissions";
import { db } from "~/server/db";
import { users, jobs } from "~/server/chat/tables";
import type { ChatJob } from "~/server/chat/access";
import type { RequestUser } from "~/server/utils/get-request-identity";
import type { DocumentActor } from "./domain";

export function checkDocumentAccess(
  user: RequestUser | null,
  job: ChatJob | null,
) {
  if (!user)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in to view documents.",
    });
  if (
    !user.organizationId ||
    user.organizationAccessStatus !== "approved" ||
    !userCan(user, "tab.dashboard")
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Approved organization and dashboard access are required.",
    });
  if (job?.organizationId !== user.organizationId)
    throw new TRPCError({ code: "NOT_FOUND", message: "Job not found." });
  const canWrite = userCan(user, "documents.manage");
  return { user, job, canWrite, canManage: canWrite && hasManagingSeat(user) };
}
export async function assertDocumentAccess(
  userId: string | null,
  jobId: string,
  reader: Pick<typeof db, "select"> = db,
) {
  if (!userId)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in to view documents.",
    });
  const [[user], [job]] = await Promise.all([
    reader.select().from(users).where(eq(users.id, userId)).limit(1),
    reader.select().from(jobs).where(eq(jobs.id, jobId)).limit(1),
  ]);
  return checkDocumentAccess(
    (user ?? null) as RequestUser | null,
    (job ?? null) as ChatJob | null,
  );
}
export type DocumentAccess = Awaited<ReturnType<typeof assertDocumentAccess>>;
export async function documentMembers(
  access: DocumentAccess,
  reader: Pick<typeof db, "select"> = db,
) {
  const rows = await reader
    .select()
    .from(users)
    .where(
      and(
        eq(users.organizationId, access.job.organizationId),
        eq(users.organizationAccessStatus, "approved"),
      ),
    );
  return (rows as RequestUser[])
    .filter((member) => userCan(member, "tab.dashboard"))
    .map((member) => ({
      id: member.id,
      name: member.name,
      email: member.email,
      canWrite: userCan(member, "documents.manage"),
      canManage: hasManagingSeat(member) && userCan(member, "documents.manage"),
    }));
}
export function documentActor(
  access: DocumentAccess,
  memberIds: string[],
  reviewers?: DocumentActor["reviewers"],
): DocumentActor {
  return {
    userId: access.user.id,
    jobId: access.job.id,
    canManage: access.canManage,
    canWrite: access.canWrite,
    memberIds,
    reviewers,
  };
}
