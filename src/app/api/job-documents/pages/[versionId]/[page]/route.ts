import { and, eq } from "drizzle-orm";
import { db } from "~/server/db";
import { jobDrawingSheets } from "~/server/db/schema";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { documentDrawingAccess } from "~/server/documents/drawing-workspace";
import { documentHttpError } from "~/server/documents/http";
import { jobIdSchema } from "~/server/documents/contracts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A page-sized white backing; PDF.js paints the original private PDF over it. */
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
