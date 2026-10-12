import { TRPCError } from "@trpc/server";
import {
  assertChatAccess,
  checkChatAccess,
  type ChatJob,
} from "~/server/chat/access";
import { userCan } from "~/server/auth/permissions";
import type { RequestUser } from "~/server/utils/get-request-identity";
export function checkModelAccess(
  user: RequestUser | null,
  job: ChatJob | null,
) {
  const access = checkChatAccess(user, job);
  if (!userCan(access.user, "drawings.view"))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Drawing and model access is required.",
    });
  return {
    ...access,
    canUpload: userCan(access.user, "drawings.upload"),
    canDelete: userCan(access.user, "drawings.delete"),
  };
}
export async function modelAccess(
  userId: string | null | undefined,
  jobId: string,
) {
  const access = await assertChatAccess(userId, jobId);
  return checkModelAccess(access.user, access.job);
}
export type ModelAccess = ReturnType<typeof checkModelAccess>;
export function requireModelUpload(access: ModelAccess) {
  if (!access.canUpload)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Drawing upload permission is required to manage models.",
    });
}
export function requireModelDelete(access: ModelAccess) {
  if (!access.canDelete)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Drawing delete permission is required to delete models.",
    });
}
