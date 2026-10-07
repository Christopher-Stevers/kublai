import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "~/server/db";
import { jobDrawingSheets } from "~/server/db/schema";
import { drawingWorkspaceEntities } from "~/server/db/drawing-workspace-schema";
import { userCan } from "~/server/auth/permissions";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { documentHttpError } from "~/server/documents/http";
import {
  drawingAttachmentInfo,
  readDrawingAttachment,
} from "~/server/drawings/attachments";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string; fileId: string }> },
) {
  try {
    const { user } = await getRequestIdentity(request.headers, {
      allowDev: true,
    });
    if (
      !user?.organizationId ||
      user.organizationAccessStatus !== "approved" ||
      !userCan(user, "tab.dashboard")
    )
      throw new TRPCError({ code: "FORBIDDEN" });
    const { jobId, fileId } = z
      .object({ jobId: z.string().uuid(), fileId: z.string().uuid() })
      .parse(await context.params);
    const info = await drawingAttachmentInfo(jobId, fileId);
    const [sheet] = await db
      .select({ id: jobDrawingSheets.id })
      .from(jobDrawingSheets)
      .where(
        and(
          eq(jobDrawingSheets.id, info.sheetId),
          eq(jobDrawingSheets.jobId, jobId),
          eq(jobDrawingSheets.organizationId, user.organizationId),
        ),
      )
      .limit(1);
    if (!sheet) throw new TRPCError({ code: "NOT_FOUND" });
    if (info.authorId !== user.id) {
      const url = `/api/drawings/attachments/${jobId}/${fileId}`;
      const [visible] = await db
        .select({ id: drawingWorkspaceEntities.id })
        .from(drawingWorkspaceEntities)
        .where(
          and(
            eq(drawingWorkspaceEntities.jobId, jobId),
            eq(drawingWorkspaceEntities.organizationId, user.organizationId),
            sql`${drawingWorkspaceEntities.entity}->>'kind' = 'issue'`,
            sql`(${drawingWorkspaceEntities.entity}->>'visibility' = 'published' OR ${drawingWorkspaceEntities.entity}->>'authorId' = ${user.id})`,
            sql`${drawingWorkspaceEntities.entity}->'data'->'links' @> ${JSON.stringify([{ url }])}::jsonb`,
          ),
        )
        .limit(1);
      if (!visible) throw new TRPCError({ code: "NOT_FOUND" });
    }
    const { bytes, name, mime } = await readDrawingAttachment(jobId, fileId);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${mime === "application/pdf" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return documentHttpError(error);
  }
}
