import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "~/server/db";
import { jobDrawingSheets } from "~/server/db/schema";
import { userCan } from "~/server/auth/permissions";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import {
  assertSameOrigin,
  documentHttpError,
  readBoundedBody,
} from "~/server/documents/http";
import {
  MAX_DRAWING_ATTACHMENT_BYTES,
  withDrawingAttachmentSlot,
  writeDrawingAttachment,
} from "~/server/drawings/attachments";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { user } = await getRequestIdentity(request.headers, {
    request,
      allowDev: true,
    });
    if (
      !user?.organizationId ||
      user.organizationAccessStatus !== "approved" ||
      !userCan(user, "tab.dashboard")
    )
      throw new TRPCError({ code: "FORBIDDEN" });
    const url = new URL(request.url);
    const sheetId = z.string().uuid().parse(url.searchParams.get("sheetId"));
    const [sheet] = await db
      .select({ jobId: jobDrawingSheets.jobId })
      .from(jobDrawingSheets)
      .where(
        and(
          eq(jobDrawingSheets.id, sheetId),
          eq(jobDrawingSheets.organizationId, user.organizationId),
        ),
      )
      .limit(1);
    if (!sheet) throw new TRPCError({ code: "NOT_FOUND" });
    const result = await withDrawingAttachmentSlot(async () =>
      writeDrawingAttachment({
        jobId: sheet.jobId,
        sheetId,
        authorId: user.id,
        name: url.searchParams.get("name") ?? "Attachment",
        bytes: await readBoundedBody(request, MAX_DRAWING_ATTACHMENT_BYTES),
      }),
    );
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return documentHttpError(error);
  }
}
