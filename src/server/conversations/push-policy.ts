import { createHash } from "node:crypto";
import { userCan } from "~/server/auth/permissions";
import {
  messagePreview,
  nameOr,
  type PushRecipient,
} from "~/server/chat/push-policy";

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
  preview?: {
    kind: "direct" | "group";
    chatName: string | null;
    senderName: string | null;
    body: string | null;
  },
) {
  const sender = nameOr(preview?.senderName, "Someone");
  return JSON.stringify({
    type: "conversation-chat",
    url: `/dashboard/chat?conversation=${conversationId}`,
    account: createHash("sha256").update(recipientId).digest("hex"),
    tag: `conversation-chat-${conversationId}`,
    // Direct chats read like a text from the sender; groups name the group.
    ...(preview &&
      (preview.kind === "direct"
        ? { title: sender, body: messagePreview(preview.body) }
        : {
            title: nameOr(preview.chatName, "Group chat"),
            body: `${sender}: ${messagePreview(preview.body)}`,
          })),
  });
}
