import { z } from "zod";
import {
  deletePendingAttachment,
  readChatAttachment,
} from "~/server/chat/attachments";
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
    const file = await readChatAttachment(userId, id);
    const disposition =
      file.mimeType === "application/pdf" ? "attachment" : "inline";
    return new Response(new Uint8Array(file.data), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.data.length),
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
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
    await deletePendingAttachment(userId, id);
    return Response.json({ success: true });
  } catch (error) {
    return chatHttpError(error);
  }
}
