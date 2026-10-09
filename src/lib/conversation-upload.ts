import type { ConversationMessage } from "~/server/conversations/contracts";
export async function uploadConversationFile(
  conversationId: string,
  file: File,
) {
  if (file.size > 10 * 1024 * 1024)
    throw new Error("Files must be 10 MB or smaller.");
  const response = await fetch(
    `/api/chat/attachments?conversationId=${encodeURIComponent(conversationId)}`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": file.type,
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
      signal: AbortSignal.timeout(60000),
    },
  );
  const value = (await response.json()) as {
    error?: string;
    attachment?: ConversationMessage["attachments"][number];
  };
  if (!response.ok || !value.attachment)
    throw new Error(
      value.error ?? "Could not upload the image. Please try again.",
    );
  return value.attachment;
}
export async function removePendingConversationFile(id: string) {
  await fetch(`/api/chat/attachments/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
}
