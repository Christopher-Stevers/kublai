import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { userCan } from "~/server/auth/permissions";
import { assertDocumentAccess } from "~/server/documents/access";
import { jobIdSchema } from "~/server/documents/contracts";
import {
  assertSameOrigin,
  documentHttpError,
  readBoundedBody,
} from "~/server/documents/http";
import {
  attachSavedSlip,
  savedPackingSlips,
  saveUnmatchedSlip,
} from "~/server/documents/service";
import {
  detectedDocumentMime,
  MAX_DOCUMENT_FILE_BYTES,
  safeDocumentName,
  writeDocumentBlob,
} from "~/server/documents/storage";
import { identifySlipOrder } from "~/server/packing-slips/find-order-service";
import { startSlipAnalysis } from "~/server/packing-slips/service";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

async function receiver(request: Request, jobId: string) {
  const { userId } = await getRequestIdentity(request.headers, { request });
  const access = await assertDocumentAccess(userId, jobId);
  if (!userCan(access.user, "orders.receive"))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Order receiving permission is required.",
    });
  return { access };
}

/** Saved packing slips to choose from instead of scanning. */
export async function GET(request: Request) {
  try {
    const jobId = jobIdSchema.parse(
      new URL(request.url).searchParams.get("jobId"),
    );
    const { access } = await receiver(request, jobId);
    return Response.json(
      { slips: await savedPackingSlips(access) },
      { headers },
    );
  } catch (error) {
    return documentHttpError(error);
  }
}

const action = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("identify"),
    jobId: z.uuid(),
    documentId: z.uuid(),
  }),
  z.object({
    action: z.literal("link"),
    jobId: z.uuid(),
    documentId: z.uuid(),
    orderId: z.uuid(),
  }),
]);

/** A new scan (multipart `file`) is saved, then matched to an order; a saved
 * slip is matched by `identify`. `link` attaches it to the chosen order and
 * starts the full reading. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.startsWith("multipart/form-data;")) {
      const jobId = jobIdSchema.parse(
        new URL(request.url).searchParams.get("jobId"),
      );
      await receiver(request, jobId);
      const body = await readBoundedBody(
        request,
        MAX_DOCUMENT_FILE_BYTES + 64 * 1024,
      );
      let form: FormData;
      try {
        form = await new Response(new Uint8Array(body), {
          headers: { "content-type": contentType },
        }).formData();
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid multipart upload.",
        });
      }
      const file = form.get("file");
      if (!file || typeof file === "string" || form.getAll("file").length !== 1)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose exactly one file.",
        });
      if (file.size === 0 || file.size > MAX_DOCUMENT_FILE_BYTES)
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: "Upload a nonempty file no larger than 50 MB.",
        });
      // Recheck current account permissions after receiving the potentially slow body.
      const { access } = await receiver(request, jobId);
      const name = safeDocumentName(file.name);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mimeType = detectedDocumentMime(bytes, name);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const saved = await saveUnmatchedSlip(
        access,
        { name, size: bytes.length, mimeType, sha256 },
        () => writeDocumentBlob(access.job.organizationId, bytes),
      );
      let analysisError: string | undefined;
      try {
        await startSlipAnalysis(access, saved.documentId);
      } catch {
        analysisError = "Packing slip saved, but reading could not start. Open the saved slip to retry detection.";
      }
      return Response.json({documentId:saved.documentId,match:null,candidates:[],orders:[],queued:true,analysisError},{headers});
    }
    const body = action.parse(
      JSON.parse((await readBoundedBody(request, 8 * 1024)).toString("utf8")),
    );
    const { access } = await receiver(request, body.jobId);
    if (body.action === "identify")
      return Response.json(await identifySlipOrder(access, body.documentId), {
        headers,
      });
    const linked = await attachSavedSlip(access, body.documentId, body.orderId);
    let analysisError: string | undefined;
    try {
      await startSlipAnalysis(access, linked.documentId);
    } catch {
      analysisError =
        "Packing slip saved, but reading could not start. Use Analyze slip to retry.";
    }
    return Response.json(
      {
        documentId: linked.documentId,
        orderId: linked.orderId,
        materialListId: linked.materialListId,
        analysisError,
      },
      { headers },
    );
  } catch (error) {
    return documentHttpError(error);
  }
}
