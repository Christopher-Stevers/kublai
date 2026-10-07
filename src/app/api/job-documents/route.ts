import { TRPCError } from "@trpc/server";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { assertDocumentAccess } from "~/server/documents/access";
import {
  documentActionSchema,
  jobIdSchema,
} from "~/server/documents/contracts";
import {
  assertSameOrigin,
  documentHttpError,
  readBoundedBody,
} from "~/server/documents/http";
import { changeDocuments, documentOverview } from "~/server/documents/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const jobId = jobIdSchema.parse(
      new URL(request.url).searchParams.get("jobId"),
    );
    const { userId } = await getRequestIdentity(request.headers);
    return Response.json(
      await documentOverview(await assertDocumentAccess(userId, jobId)),
      { headers: { "Cache-Control": "private, no-store" } },
    );
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
        message: "Send a JSON document action.",
      });
    const { userId } = await getRequestIdentity(request.headers);
    if (!userId)
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Sign in to change documents.",
      });
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(
        (await readBoundedBody(request, 256 * 1024)).toString("utf8"),
      ) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid JSON request.",
        });
      throw error;
    }
    const jobId = jobIdSchema.parse(input?.jobId);
    const action = documentActionSchema.parse(input);
    const result = await changeDocuments(
      await assertDocumentAccess(userId, jobId),
      action,
    );
    return Response.json(
      { success: true, ...result },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return documentHttpError(error);
  }
}
