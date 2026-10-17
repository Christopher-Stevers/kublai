import { z } from "zod";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { assertDocumentAccess } from "~/server/documents/access";
import { packingSlipDocuments } from "~/server/documents/service";
import { documentHttpError } from "~/server/documents/http";
import { userCan } from "~/server/auth/permissions";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const jobId = z.uuid().parse(params.get("jobId")),
      listId = z.uuid().parse(params.get("materialListId"));
    const orderId = z
      .uuid()
      .optional()
      .parse(params.get("orderId") ?? undefined);
    const { userId } = await getRequestIdentity(request.headers, { request });
    const access = await assertDocumentAccess(userId, jobId);
    const documents = await packingSlipDocuments(access, listId, orderId);
    return Response.json(
      {
        canUpload: userCan(access.user, "orders.receive"),
        documents,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return documentHttpError(error);
  }
}
