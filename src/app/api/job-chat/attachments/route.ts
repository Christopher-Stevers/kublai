import { z } from "zod";
import { assertChatAccess } from "~/server/chat/access";
import { uploadChatAttachment } from "~/server/chat/attachments";
import { chatHttpError } from "~/server/chat/http";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!z.uuid().safeParse(jobId).success)
    return Response.json({ error: "Invalid job." }, { status: 400 });
  try {
    const { userId } = await getRequestIdentity(request.headers);
    const access = await assertChatAccess(userId, jobId!);
    return Response.json(
      { attachment: await uploadChatAttachment(access, request) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return chatHttpError(error);
  }
}
