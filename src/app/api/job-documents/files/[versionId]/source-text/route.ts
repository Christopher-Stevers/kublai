import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { assertDocumentAccess } from "~/server/documents/access";
import { jobIdSchema } from "~/server/documents/contracts";
import { documentHttpError } from "~/server/documents/http";
import { readableVersion } from "~/server/documents/service";
import { savedSlipSourceWords } from "~/server/packing-slips/saved-source-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  try {
    const jobId = jobIdSchema.parse(
      new URL(request.url).searchParams.get("jobId"),
    );
    const versionId = jobIdSchema.parse((await params).versionId);
    const { userId } = await getRequestIdentity(request.headers, { request });
    const access = await assertDocumentAccess(userId, jobId);
    const { version } = await readableVersion(access, versionId);
    const words = await savedSlipSourceWords(
      access.job.organizationId,
      version.sha256,
    );
    return Response.json(
      { words },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Resource-Policy": "same-origin",
        },
      },
    );
  } catch (error) {
    return documentHttpError(error);
  }
}
