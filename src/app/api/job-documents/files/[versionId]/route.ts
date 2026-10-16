import {
  isNotModified,
  rangeMatches,
  singleByteRange,
} from "~/server/rooms/file-response";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { assertDocumentAccess } from "~/server/documents/access";
import { jobIdSchema } from "~/server/documents/contracts";
import { documentHttpError } from "~/server/documents/http";
import { readableVersion } from "~/server/documents/service";
import { openDocumentBlob } from "~/server/documents/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function serve(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
  head = false,
) {
  let cleanup: (() => Promise<void>) | undefined;
  try {
    const url = new URL(request.url);
    const jobId = jobIdSchema.parse(url.searchParams.get("jobId"));
    const versionId = jobIdSchema.parse((await params).versionId);
    const { userId } = await getRequestIdentity(request.headers, { request });
    const access = await assertDocumentAccess(userId, jobId);
    const { version } = await readableVersion(access, versionId);
    const file = await openDocumentBlob(
      access.job.organizationId,
      version.sha256,
    );
    cleanup = file.close;
    const close = async () => {
      await file.close();
      cleanup = undefined;
    };
    const inline =
      url.searchParams.get("download") !== "1" &&
      [
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
      ].includes(version.mimeType);
    const headers = new Headers({
      "Content-Type": version.mimeType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(version.name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`)}`,
      // Revalidate through the document ACL on every use, including cache hits.
      "Cache-Control": "private, no-cache, no-transform",
      ETag: file.etag,
      "Last-Modified": file.modified.toUTCString(),
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    if (isNotModified(request.headers, file.etag, file.modified)) {
      await close();
      return new Response(null, { status: 304, headers });
    }
    const range =
      !head && rangeMatches(request.headers, file.etag, file.modified)
        ? singleByteRange(request.headers.get("range"), file.size)
        : null;
    if (range === "unsatisfiable") {
      await close();
      headers.set("Content-Range", `bytes */${file.size}`);
      headers.set("Content-Length", "0");
      return new Response(null, { status: 416, headers });
    }
    headers.set(
      "Content-Length",
      String(range ? range.end - range.start + 1 : file.size),
    );
    if (head) {
      await close();
      return new Response(null, { headers });
    }
    if (range)
      headers.set(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${file.size}`,
      );
    const response = new Response(file.stream(range?.start, range?.end), {
      status: range ? 206 : 200,
      headers,
    });
    cleanup = undefined; // The stream now owns completion/cancellation cleanup.
    return response;
  } catch (error) {
    return documentHttpError(error);
  } finally {
    await cleanup?.().catch(() => undefined);
  }
}
export async function GET(
  request: Request,
  context: { params: Promise<{ versionId: string }> },
) {
  return serve(request, context);
}
export async function HEAD(
  request: Request,
  context: { params: Promise<{ versionId: string }> },
) {
  return serve(request, context, true);
}
