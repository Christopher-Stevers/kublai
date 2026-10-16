import { isNotModified } from "~/server/rooms/file-response";
import { documentPagePreview } from "~/server/documents/page-preview";
import { and, eq } from "drizzle-orm";
import { db } from "~/server/db";
import { jobDrawingSheets } from "~/server/db/schema";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { documentDrawingAccess } from "~/server/documents/drawing-workspace";
import { documentHttpError } from "~/server/documents/http";
import { jobIdSchema } from "~/server/documents/contracts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cached preview ink; the original PDF supplies exact detail at every zoom. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string; page: string }> },
) {
  try {
    const { versionId: rawVersion, page: rawPage } = await params;
    const versionId = jobIdSchema.parse(rawVersion);
    const jobId = jobIdSchema.parse(
      new URL(request.url).searchParams.get("jobId"),
    );
    const page = Number(rawPage);
    if (!Number.isSafeInteger(page) || page < 1 || page > 2000)
      return new Response(null, { status: 404 });
    const { userId } = await getRequestIdentity(request.headers, { request });
    if (!userId) return new Response(null, { status: 401 });
    const access = await documentDrawingAccess(db, userId, jobId, versionId);
    const [sheet] = await db
      .select({
        width: jobDrawingSheets.width,
        height: jobDrawingSheets.height,
      })
      .from(jobDrawingSheets)
      .where(
        and(
          eq(jobDrawingSheets.documentVersionId, versionId),
          eq(jobDrawingSheets.jobId, jobId),
          eq(jobDrawingSheets.organizationId, access.actor.organizationId),
          eq(jobDrawingSheets.sortOrder, page),
        ),
      )
      .limit(1);
    if (!sheet) return new Response(null, { status: 404 });
    const etag = `"preview-v1-${access.version.sha256}-${page}"`;
    if (
      request.headers.has("if-none-match") &&
      isNotModified(request.headers, etag, new Date(0))
    )
      return new Response(null, {
        status: 304,
        headers: { ETag: etag, "Cache-Control": "private, no-cache" },
      });
    try {
      // Native preparation continues in the bounded queue if it outlasts the
      // small preview budget. Never hold first PDF detail behind a slow preview.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const preview = await Promise.race([
        documentPagePreview(
          access.actor.organizationId,
          access.version.sha256,
          page,
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Preview still preparing")),
            500,
          );
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      return new Response(new Uint8Array(preview), {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "private, no-cache, no-transform",
          ETag: etag,
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Resource-Policy": "same-origin",
        },
      });
    } catch {
      /* PDF detail remains available if this bounded preview fails. */
    }
    return new Response(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.width}" height="${sheet.height}"><rect width="100%" height="100%" fill="white"/></svg>`,
      {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      },
    );
  } catch (error) {
    return documentHttpError(error);
  }
}
