import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { assertSameOrigin, readBoundedBody } from "~/server/documents/http";
import { modelHttpError } from "~/server/models/http";
import { modelAccess, requireModelUpload } from "~/server/models/access";
import { startModelUpload } from "~/server/models/storage";
import { uploadMetadataSchema } from "~/lib/bim/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { userId } = await getRequestIdentity(request.headers, { request });
    const input = uploadMetadataSchema.parse(
      JSON.parse((await readBoundedBody(request, 8192)).toString("utf8")),
    );
    const access = await modelAccess(userId, input.jobId);
    requireModelUpload(access);
    return Response.json(await startModelUpload(access, input), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return modelHttpError(error);
  }
}
