import { createHash } from "node:crypto";
import { userCan } from "~/server/auth/permissions";
import type { PushRecipient } from "~/server/chat/push-policy";

export function eligibleForConversationPush(input: {
  user: PushRecipient;
  organizationId: string;
  senderId: string;
  sequence: number;
  subscriptionUserId: string;
  member: { lastReadSequence: number } | null;
}) {
  return (
    input.user.id === input.subscriptionUserId &&
    input.user.id !== input.senderId &&
    input.user.organizationId === input.organizationId &&
    input.user.organizationAccessStatus === "approved" &&
    userCan(input.user, "tab.dashboard") &&
    input.member !== null &&
    input.member.lastReadSequence < input.sequence
  );
}

export function conversationPushPayload(
  conversationId: string,
  recipientId: string,
) {
  // Names, message bodies and attachments never appear on a lock screen.
  return JSON.stringify({
    type: "conversation-chat",
    url: `/dashboard/chat?conversation=${conversationId}`,
    account: createHash("sha256").update(recipientId).digest("hex"),
    tag: `conversation-chat-${conversationId}`,
  });
}
