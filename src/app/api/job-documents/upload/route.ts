import { startSlipAnalysis } from "~/server/packing-slips/service";
import { userCan } from "~/server/auth/permissions";
import { documentPagePreview } from "~/server/documents/page-preview";
import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { assertDocumentAccess, documentActor } from "~/server/documents/access";
import {
  accessibleDocument,
  assertFolderRole,
} from "~/server/documents/domain";
import {
  uploadMetadataSchema,
  parseSubmittalUpload,
  jobIdSchema,
} from "~/server/documents/contracts";
import {
  assertSameOrigin,
  documentHttpError,
  readBoundedBody,
} from "~/server/documents/http";
import { readWorkspace, saveDocumentVersion } from "~/server/documents/service";
import {
  detectedDocumentMime,
  MAX_DOCUMENT_FILE_BYTES,
  safeDocumentName,
  writeDocumentBlob,
} from "~/server/documents/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const jobId = jobIdSchema.parse(
      new URL(request.url).searchParams.get("jobId"),
    );
    const { userId } = await getRequestIdentity(request.headers, { request });
    const access = await assertDocumentAccess(userId, jobId);
    if (!access.canWrite && !userCan(access.user, "orders.receive"))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Document editing permission is required.",
      });
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.startsWith("multipart/form-data;"))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Send a multipart file upload.",
      });
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
    const field = (name: string) => {
      const value = form.get(name);
      return value === "" ? null : value;
    };
    const metadata = uploadMetadataSchema.parse({
      jobId,
      packingSlipOrderId: field("packingSlipOrderId") ?? undefined,
      submittal: parseSubmittalUpload(form.get("submittal")),
      folderId: field("folderId") ?? null,
      documentId: field("documentId") ?? undefined,
      expectedVersionId: field("expectedVersionId") ?? undefined,
      name: safeDocumentName(file.name),
    });
    // Recheck current account permissions after receiving the potentially slow body.
    const fresh = await assertDocumentAccess(userId, jobId);
    if (!metadata.packingSlipOrderId && !fresh.canWrite)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Document editing permission is required.",
      });
    if (
      metadata.packingSlipOrderId &&
      (metadata.documentId ||
        metadata.folderId ||
        metadata.submittal ||
        metadata.expectedVersionId)
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Upload packing slips as new attachments.",
      });
    const state = await readWorkspace(fresh);
    const actor = documentActor(fresh, []);
    if (metadata.documentId) {
      const doc = accessibleDocument(state, actor, metadata.documentId, {
        write: true,
      });
      if (
        !metadata.expectedVersionId ||
        metadata.expectedVersionId !== doc.currentVersionId
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "A newer version exists. Refresh before uploading.",
        });
    } else if (!metadata.packingSlipOrderId)
      assertFolderRole(state, actor, metadata.folderId ?? null, "editor");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mimeType = detectedDocumentMime(bytes, metadata.name);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const result = await saveDocumentVersion(
      fresh,
      { ...metadata, size: bytes.length, mimeType, sha256 },
      () => writeDocumentBlob(fresh.job.organizationId, bytes),
    );
    if (mimeType === "application/pdf")
      void documentPagePreview(fresh.job.organizationId, sha256, 1).catch(
        () => undefined,
      );
    let analysisError: string | undefined;
    if (metadata.packingSlipOrderId) {
      try {
        await startSlipAnalysis(fresh, result.documentId);
      } catch {
        analysisError =
          "PDF saved, but analysis could not start. Use Analyze slip to retry.";
      }
    }
    return Response.json(
      { success: true, ...result, analysisError },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return documentHttpError(error);
  }
}
