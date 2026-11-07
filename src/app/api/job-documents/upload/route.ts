import { startSlipAnalysis } from "~/server/packing-slips/service";
import { userCan } from "~/server/auth/permissions";
import { documentPagePreview } from "~/server/documents/page-preview";
import { TRPCError } from "@trpc/server";
import { receiveDocumentUpload } from "~/server/documents/stream-upload";
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
import { assertSameOrigin, documentHttpError } from "~/server/documents/http";
import { readWorkspace, saveDocumentVersion } from "~/server/documents/service";
import {
  detectedDocumentMime,
  safeDocumentName,
} from "~/server/documents/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let upload: Awaited<ReturnType<typeof receiveDocumentUpload>> | undefined;
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
    upload = await receiveDocumentUpload(request, access.job.organizationId);
    const file = upload;
    const form = upload.fields;
    const field = (name: string) => {
      const value = form.get(name);
      return value === "" ? null : value;
    };
    const metadata = uploadMetadataSchema.parse({
      jobId,
      packingSlipOrderId: field("packingSlipOrderId") ?? undefined,
      submittal: parseSubmittalUpload(form.get("submittal") ?? null),
      folderId: field("folderId") ?? null,
      documentId: field("documentId") ?? undefined,
      expectedVersionId: field("expectedVersionId") ?? undefined,
      name: safeDocumentName(file.name),
    });
    // Recheck current account permissions after receiving the potentially slow body.
    const fresh = await assertDocumentAccess(userId, jobId);
    if (fresh.job.organizationId !== access.job.organizationId)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Document access changed. Retry the upload.",
      });
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
    const mimeType = detectedDocumentMime(upload.header, metadata.name);
    const sha256 = upload.sha256;
    const result = await saveDocumentVersion(
      fresh,
      { ...metadata, size: upload.size, mimeType, sha256 },
      upload.publish,
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
  } finally {
    await upload?.dispose();
  }
}
