import { safeAttachmentResponse } from "~/server/http/attachment-response";
import { z } from "zod";
import {
  deleteConversationAttachment,
  readConversationAttachment,
} from "~/server/conversations/attachments";
import { chatHttpError } from "~/server/chat/http";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return new Response("Not found", { status: 404 });
  try {
    const { userId } = await getRequestIdentity(request.headers, { request });
    const file = await readConversationAttachment(userId, id);
    return safeAttachmentResponse(file);
  } catch (error) {
    return chatHttpError(error);
  }
}
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return new Response("Not found", { status: 404 });
  try {
    const { userId } = await getRequestIdentity(request.headers, { request });
    if (!userId) return new Response("Unauthorized", { status: 401 });
    await deleteConversationAttachment(userId, id);
    return Response.json({ success: true });
  } catch (error) {
    return chatHttpError(error);
  }
}
