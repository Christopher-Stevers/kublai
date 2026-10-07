import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { assertDocumentAccess } from "~/server/documents/access";
import {
  assertSameOrigin,
  documentHttpError,
  readBoundedBody,
} from "~/server/documents/http";
import {
  documentEditorSaveStatus,
  registerDocumentEditorSave,
} from "~/server/documents/editor-save";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const inputSchema = z
  .object({ jobId: z.uuid(), documentId: z.uuid(), requestId: z.uuid() })
  .strict();
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
async function identity(request: Request) {
  const { userId } = await getRequestIdentity(request.headers);
  if (!userId)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in to confirm document saves.",
    });
  return userId;
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const userId = await identity(request);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Send a JSON save request.",
      });
    let input: z.infer<typeof inputSchema>;
    try {
      input = inputSchema.parse(
        JSON.parse((await readBoundedBody(request, 4096)).toString("utf8")),
      );
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid save request.",
        });
      throw error;
    }
    const access = await assertDocumentAccess(userId, input.jobId);
    return Response.json(
      await registerDocumentEditorSave(
        access,
        input.documentId,
        input.requestId,
      ),
      { headers },
    );
  } catch (error) {
    return documentHttpError(error);
  }
}
export async function GET(request: Request) {
  try {
    assertSameOrigin(request);
    const userId = await identity(request);
    const input = inputSchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const access = await assertDocumentAccess(userId, input.jobId);
    return Response.json(
      await documentEditorSaveStatus(access, input.documentId, input.requestId),
      { headers },
    );
  } catch (error) {
    return documentHttpError(error);
  }
}
