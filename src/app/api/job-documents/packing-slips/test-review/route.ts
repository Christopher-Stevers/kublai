import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { assertDocumentAccess } from "~/server/documents/access";
import { readableVersion } from "~/server/documents/service";
import { documentHttpError } from "~/server/documents/http";
import { slipTestReviewSchema } from "~/lib/packing-slip-test-review";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const jobId = z.uuid().parse(url.searchParams.get("jobId"));
    const versionId = z.uuid().parse(url.searchParams.get("versionId"));
    const { userId } = await getRequestIdentity(request.headers, { request });
    const access = await assertDocumentAccess(userId, jobId);
    const { document } = await readableVersion(access, versionId);
    const headers = { "Cache-Control": "private, no-store" };
    if (!document.packingSlip)
      return Response.json({ review: null }, { headers });
    const filename = path.join(
      process.env.JOB_DOCUMENT_STORAGE_ROOT ?? "uploads/job-documents",
      "packing-slip-tests",
      access.job.organizationId,
      jobId,
      `${versionId}.json`,
    );
    let raw: string;
    try {
      raw = await readFile(filename, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return Response.json({ review: null }, { headers });
      throw error;
    }
    const review = slipTestReviewSchema.parse(JSON.parse(raw));
    if (review.versionId !== versionId || review.documentId !== document.id)
      throw Error("Review source mismatch");
    return Response.json({ review }, { headers });
  } catch (error) {
    return documentHttpError(error);
  }
}
