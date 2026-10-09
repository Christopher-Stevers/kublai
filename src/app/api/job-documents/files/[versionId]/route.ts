import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { assertDocumentAccess } from "~/server/documents/access";
import { jobIdSchema } from "~/server/documents/contracts";
import { documentHttpError } from "~/server/documents/http";
import { readableVersion } from "~/server/documents/service";
import { readDocumentBlob } from "~/server/documents/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  try {
    const url = new URL(request.url);
    const jobId = jobIdSchema.parse(url.searchParams.get("jobId"));
    const versionId = jobIdSchema.parse((await params).versionId);
    const { userId } = await getRequestIdentity(request.headers, { request });
    const access = await assertDocumentAccess(userId, jobId);
    const { version } = await readableVersion(access, versionId);
    const bytes = await readDocumentBlob(
      access.job.organizationId,
      version.sha256,
    );
    const inline =
      url.searchParams.get("download") !== "1" &&
      [
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
      ].includes(version.mimeType);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": version.mimeType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(version.name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch (error) {
    return documentHttpError(error);
  }
}
