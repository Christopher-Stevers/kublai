import { cleanupExpiredChatAttachments } from "./attachments";
import { cleanupExpiredConversationAttachments } from "../conversations/attachments";

/** Both chat systems get maintenance even when one cleanup needs to retry. */
export async function cleanupChatAttachments() {
  const results = await Promise.allSettled([
    cleanupExpiredChatAttachments(),
    cleanupExpiredConversationAttachments(),
  ]);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason as unknown),
      "Chat attachment maintenance will retry.",
    );
}
