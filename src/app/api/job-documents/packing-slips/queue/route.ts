import { z } from "zod";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { assertDocumentAccess } from "~/server/documents/access";
import {
  assertSameOrigin,
  documentHttpError,
  readBoundedBody,
} from "~/server/documents/http";
import { receivingInput } from "~/server/packing-slips/receiving-input";
import {
  mutateReceiving,
  SupplierPartLinkConflictError,
  receivingQueue,
  receivingOrderComparison,
  receivingOrderCandidates,
} from "~/server/packing-slips/receiving-service";
import { startSlipAnalysis } from "~/server/packing-slips/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams,
      jobId = z.uuid().parse(q.get("jobId")),
      documentId = z
        .uuid()
        .optional()
        .parse(q.get("documentId") ?? undefined);
    const { userId } = await getRequestIdentity(request.headers, { request });
    const access = await assertDocumentAccess(userId, jobId);
    if (q.get("rankOrders") === "1") {
      if (!documentId)
        throw new Error("A packing slip is required for ranking.");
      return Response.json(await receivingOrderCandidates(access, documentId), {
        headers,
      });
    }
    if (q.has("compareOrderId")) {
      const orderId = z.uuid().parse(q.get("compareOrderId"));
      if (!documentId)
        throw new Error("A packing slip is required for comparison.");
      return Response.json(
        await receivingOrderComparison(access, documentId, orderId),
        { headers },
      );
    }
    return Response.json(
      await receivingQueue(
        access,
        documentId,
        (q.get("q") ?? "").slice(0, 100),
      ),
      { headers },
    );
  } catch (e) {
    return documentHttpError(e);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const raw: unknown = JSON.parse(
      (await readBoundedBody(request, 256 * 1024)).toString("utf8"),
    );
    const prepare = z
      .object({
        action: z.literal("prepare"),
        jobId: z.uuid(),
        documentId: z.uuid(),
      })
      .safeParse(raw);
    const body = prepare.success ? prepare.data : receivingInput.parse(raw);
    const { userId } = await getRequestIdentity(request.headers, { request });
    const access = await assertDocumentAccess(userId, body.jobId);
    if (body.action === "prepare") {
      await startSlipAnalysis(access, body.documentId);
      return Response.json({ success: true }, { headers });
    }
    return Response.json(await mutateReceiving(access, body), { headers });
  } catch (e) {
    if (e instanceof SupplierPartLinkConflictError)
      return Response.json({ supplierPartLinkConflict: e.linkConflict }, { status: 409, headers });
    return documentHttpError(e);
  }
}
