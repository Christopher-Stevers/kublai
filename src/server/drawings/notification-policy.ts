import { createHash } from "node:crypto";
import type {
  DrawingEntity,
  DrawingNotification,
} from "~/lib/drawing-workspace";
import type { PushRecipient } from "~/server/chat/push-policy";
import { userCan } from "~/server/auth/permissions";
export function drawingNotificationUrl(
  jobId: string,
  setId: string,
  sheetId: string,
) {
  return `/dashboard/jobs/${jobId}/drawings?drawingSet=${setId}&drawingSheet=${sheetId}`;
}
export function drawingNotificationReason(
  entity: DrawingEntity,
  userId: string,
  watching: boolean,
): DrawingNotification["reason"] | null {
  if (entity.visibility !== "published") return null;
  if (entity.kind === "issue" && entity.data.assigneeId === userId)
    return "assignment";
  if (
    entity.kind === "review" &&
    entity.data.status === "pending" &&
    entity.data.reviewerId === userId
  )
    return "review";
  return watching ? "watch" : null;
}
export function eligibleDrawingRecipient(input: {
  user: PushRecipient;
  organizationId: string;
  senderId: string;
  entity: DrawingEntity;
  watching: boolean;
  subscriptionUserId?: string;
  readAt?: unknown;
  reviewDecided?: boolean;
}) {
  return (
    !input.readAt &&
    !input.reviewDecided &&
    input.user.id !== input.senderId &&
    (!input.subscriptionUserId || input.subscriptionUserId === input.user.id) &&
    input.user.organizationId === input.organizationId &&
    input.user.organizationAccessStatus === "approved" &&
    userCan(input.user, "tab.dashboard") &&
    drawingNotificationReason(input.entity, input.user.id, input.watching) !==
      null
  );
}
export function drawingPushPayload(
  jobId: string,
  setId: string,
  sheetId: string,
  recipientId: string,
) {
  return JSON.stringify({
    type: "job-drawing",
    url: drawingNotificationUrl(jobId, setId, sheetId),
    account: createHash("sha256").update(recipientId).digest("hex"),
    tag: `job-drawing-${sheetId}`,
  });
}
