export type ChatTarget =
  | { mode: "existing"; conversationId: string }
  | { mode: "direct" | "group"; recipientIds: string[]; name: string };
export function validChatTarget(target: ChatTarget) {
  return target.mode === "existing"
    ? Boolean(target.conversationId)
    : target.recipientIds.length > 0 &&
        target.recipientIds.length <= 49 &&
        (target.mode !== "direct" || target.recipientIds.length === 1) &&
        (target.mode !== "group" || Boolean(target.name.trim()));
}
