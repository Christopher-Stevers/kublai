import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { db as database } from "~/server/db";
import { jobDrawingSets, jobDrawingSheets } from "~/server/db/schema";
import { drawingWorkspaceMetadata } from "~/server/db/drawing-workspace-schema";
import { defaultDrawingMetadata } from "./domain";
import type { renderUploadPdf } from "~/server/rooms/upload-render";
import type { UploadSession } from "~/server/rooms/upload-session";
/** Publish the pages and their extracted identities together, with stable per-page IDs. */
export async function addDrawingUpload(
  db: typeof database,
  s: UploadSession,
  setId: string,
  sheets: Awaited<ReturnType<typeof renderUploadPdf>>,
) {
  await db.transaction(async (tx) => {
    const [set] = await tx
      .select({ id: jobDrawingSets.id })
      .from(jobDrawingSets)
      .where(
        and(
          eq(jobDrawingSets.id, setId),
          eq(jobDrawingSets.jobId, s.jobId),
          eq(jobDrawingSets.organizationId, s.organizationId),
          isNull(jobDrawingSets.documentVersionId),
        ),
      )
      .for("update");
    if (!set) throw Error("Drawing folder no longer available");
    const [last] = await tx
      .select({ sortOrder: jobDrawingSheets.sortOrder })
      .from(jobDrawingSheets)
      .where(eq(jobDrawingSheets.setId, setId))
      .orderBy(desc(jobDrawingSheets.sortOrder))
      .limit(1);
    if (sheets.length) {
      const rows = sheets.map((sheet, index) => ({
        id: randomUUID(),
        organizationId: s.organizationId,
        jobId: s.jobId,
        setId,
        name: sheet.name.slice(0, 255),
        imageUrl: sheet.imageUrl,
        width: sheet.width,
        height: sheet.height,
        sortOrder: (last?.sortOrder ?? 0) + index + 1,
        sourceFilename: s.filename.slice(0, 255),
        uploadedByUserId: s.userId,
      }));
      await tx.insert(jobDrawingSheets).values(rows);
      await tx
        .insert(drawingWorkspaceMetadata)
        .values(
          rows.map((row, index) => ({
            sheetId: row.id,
            revision: 1,
            data: {
              ...defaultDrawingMetadata(row.id),
              ...sheets[index]!.metadata,
              revision: 1,
            },
          })),
        );
    }
    await tx
      .update(jobDrawingSets)
      .set({ updatedAt: new Date() })
      .where(eq(jobDrawingSets.id, setId));
  });
}
