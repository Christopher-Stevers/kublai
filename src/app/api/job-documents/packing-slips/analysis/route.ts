import { z } from "zod";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { assertDocumentAccess } from "~/server/documents/access";
import {
  assertSameOrigin,
  documentHttpError,
  readBoundedBody,
} from "~/server/documents/http";
import {
  startSlipAnalysis,
  confirmSlipReceipt,
  refreshSlipReview,
} from "~/server/packing-slips/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("analyze"),
    jobId: z.uuid(),
    documentId: z.uuid(),
  }),
  z.object({
    action: z.literal("refresh"),
    jobId: z.uuid(),
    documentId: z.uuid(),
    runId: z.uuid(),
  }),
  z.object({
    action: z.literal("confirm"),
    jobId: z.uuid(),
    documentId: z.uuid(),
    runId: z.uuid(),
    quantities: z
      .record(z.uuid(), z.number().finite().min(0).max(999999))
      .refine((q) => Object.keys(q).length <= 200),
    links: z
      .record(z.string().regex(/^\d{1,3}$/), z.uuid().nullable())
      .refine((l) => Object.keys(l).length <= 200)
      .optional(),
  }),
]);
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = input.parse(
      JSON.parse((await readBoundedBody(request, 32 * 1024)).toString("utf8")),
    );
    const { userId } = await getRequestIdentity(request.headers, { request });
    const access = await assertDocumentAccess(userId, body.jobId);
    const result =
      body.action === "analyze"
        ? await startSlipAnalysis(access, body.documentId, true)
        : body.action === "refresh"
          ? await refreshSlipReview(access, body.documentId, body.runId)
          : await confirmSlipReceipt(
              access,
              body.documentId,
              body.runId,
              body.quantities,
              body.links,
            );
    return Response.json(
      { success: true, result },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return documentHttpError(e);
  }
}
