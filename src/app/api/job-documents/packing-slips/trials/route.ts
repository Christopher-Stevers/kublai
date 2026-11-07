import { z } from "zod";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { assertDocumentAccess } from "~/server/documents/access";
import { documentHttpError } from "~/server/documents/http";
import {
  trialDocument,
  trialSummary,
} from "~/server/packing-slips/trial-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const jobId = z.uuid().parse(params.get("jobId"));
    const documentId = z
      .uuid()
      .optional()
      .parse(params.get("documentId") ?? undefined);
    const { userId } = await getRequestIdentity(request.headers, { request });
    const access = await assertDocumentAccess(userId, jobId);
    const result = documentId
      ? await trialDocument(access, documentId)
      : await trialSummary(access);
    return Response.json(
      { trial: result },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return documentHttpError(e);
  }
}
