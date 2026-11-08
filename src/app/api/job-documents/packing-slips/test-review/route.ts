import { devFeaturesEnabled, devFeatureUnavailable } from "~/server/dev-features";
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
  if (!devFeaturesEnabled()) return devFeatureUnavailable();
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
    if (url.searchParams.has("page")) {
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(20)
        .parse(url.searchParams.get("page"));
      if (!review.preparedPages?.includes(page))
        return new Response(null, { status: 404, headers });
      const png = await readFile(
        path.join(path.dirname(filename), `${versionId}-page-${page}.png`),
      );
      return new Response(new Uint8Array(png), {
        headers: {
          ...headers,
          "Content-Type": "image/png",
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Resource-Policy": "same-origin",
        },
      });
    }
    return Response.json({ review }, { headers });
  } catch (error) {
    return documentHttpError(error);
  }
}
