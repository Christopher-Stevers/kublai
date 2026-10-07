import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { assertDocumentAccess } from "~/server/documents/access";
import {
  assertSameOrigin,
  documentHttpError,
  readBoundedBody,
} from "~/server/documents/http";
import { documentEditorStatus } from "~/server/documents/editor-config";
import {
  launchDocumentEditor,
  wopiErrorResponse,
} from "~/server/documents/wopi";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const launchInput = z.object({ jobId: z.uuid(), documentId: z.uuid() });
export async function GET(request: Request) {
  try {
    const { userId } = await getRequestIdentity(request.headers);
    if (!userId)
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Sign in to use the document editor.",
      });
    return Response.json(documentEditorStatus(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return documentHttpError(error);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Send a JSON editor request.",
      });
    const { userId } = await getRequestIdentity(request.headers);
    if (!userId)
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Sign in to use the document editor.",
      });
    let input: z.infer<typeof launchInput>;
    try {
      input = launchInput.parse(
        JSON.parse(
          (await readBoundedBody(request, 16 * 1024)).toString("utf8"),
        ),
      );
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid editor request.",
        });
      throw error;
    }
    const access = await assertDocumentAccess(userId, input.jobId);
    return Response.json(await launchDocumentEditor(access, input.documentId), {
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "PRECONDITION_FAILED")
      return wopiErrorResponse(error);
    return documentHttpError(error);
  }
}
