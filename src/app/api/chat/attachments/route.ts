import { z } from "zod";
import { conversationAccess } from "~/server/conversations/service";
import { uploadConversationAttachment } from "~/server/conversations/attachments";
import { chatHttpError } from "~/server/chat/http";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const conversationId = new URL(request.url).searchParams.get(
    "conversationId",
  );
  if (!z.uuid().safeParse(conversationId).success)
    return Response.json({ error: "Invalid conversation." }, { status: 400 });
  try {
    const { userId } = await getRequestIdentity(request.headers);
    const access = await conversationAccess(userId, conversationId!);
    return Response.json(
      { attachment: await uploadConversationAttachment(access, request) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return chatHttpError(error);
  }
}
