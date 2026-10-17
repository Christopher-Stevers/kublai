import { z } from "zod";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { assertDocumentAccess } from "~/server/documents/access";
import { documentOverview } from "~/server/documents/service";
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
    const state = await documentOverview(access);
    return Response.json(
      {
        canUpload: userCan(access.user, "orders.receive"),
        documents: state.documents
          .filter(
            (d) =>
              !d.deletedAt &&
              d.packingSlip?.materialListId === listId &&
              (!orderId || d.packingSlip.orderId === orderId),
          )
          .map((d) => ({
            id: d.id,
            name: d.name,
            createdAt: d.createdAt,
            packingSlip: d.packingSlip,
          })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return documentHttpError(error);
  }
}
