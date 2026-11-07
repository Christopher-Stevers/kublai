import { describe, it, expect, vi } from "vitest";
import type { db as database } from "~/server/db";
import type { UploadSession } from "~/server/rooms/upload-session";
import { jobDrawingSheets } from "~/server/db/schema";
import { drawingWorkspaceMetadata } from "~/server/db/drawing-workspace-schema";
import { addDrawingUpload } from "./import-upload";
const session = {
  jobId: "job",
  organizationId: "company",
  userId: "worker",
  filename: "drawings.pdf",
} as UploadSession;
function databaseFixture(exists = true) {
  const inserts: Array<{ table: unknown; rows: Record<string, unknown>[] }> =
    [];
  const update = vi.fn(() => ({
    set: () => ({ where: async () => undefined }),
  }));
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => (exists ? [{ id: "folder" }] : []),
          orderBy: () => ({ limit: async () => [{ sortOrder: 9 }] }),
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: async (rows: Record<string, unknown>[]) => {
        inserts.push({ table, rows });
      },
    }),
    update,
  };
  const transaction = vi.fn(
    async (callback: (value: typeof tx) => Promise<void>) => callback(tx),
  );
  return {
    db: { transaction } as unknown as typeof database,
    inserts,
    transaction,
    update,
  };
}
describe("uploaded drawing identity persistence", () => {
  it("saves both identities with their own new sheet IDs inside the publication transaction", async () => {
    const f = databaseFixture();
    await addDrawingUpload(f.db, session, "folder", [
      {
        name: "M-100",
        width: 100,
        height: 80,
        imageUrl: "/first",
        metadata: {
          number: "M-100",
          title: "Below Grade Plumbing & Drainage",
          discipline: "Mechanical",
        },
      },
      {
        name: "A2.01",
        width: 100,
        height: 80,
        imageUrl: "/second",
        metadata: {
          number: "A2.01",
          title: "Second Floor Plan",
          discipline: "Architectural",
        },
      },
    ]);
    expect(f.transaction).toHaveBeenCalledOnce();
    expect(f.inserts.map((i) => i.table)).toEqual([
      jobDrawingSheets,
      drawingWorkspaceMetadata,
    ]);
    const rows = f.inserts[0]!.rows,
      identities = f.inserts[1]!.rows;
    expect(rows[0]!.id).not.toBe(rows[1]!.id);
    for (let index = 0; index < 2; index++) {
      expect(rows[index]).toMatchObject({
        sortOrder: 10 + index,
        organizationId: "company",
        jobId: "job",
        sourceFilename: "drawings.pdf",
      });
      expect(identities[index]).toMatchObject({
        sheetId: rows[index]!.id,
        revision: 1,
        data: {
          number: rows[index]!.name,
          currentSourceSheetId: rows[index]!.id,
          revision: 1,
          status: "draft",
        },
      });
    }
    expect(identities[0]!.data).toMatchObject({
      title: "Below Grade Plumbing & Drainage",
    });
    expect(identities[1]!.data).toMatchObject({ title: "Second Floor Plan" });
  });
  it("refuses publication when the authorized folder is gone", async () => {
    const f = databaseFixture(false);
    await expect(addDrawingUpload(f.db, session, "folder", [])).rejects.toThrow(
      "Drawing folder no longer available",
    );
    expect(f.inserts).toEqual([]);
    expect(f.update).not.toHaveBeenCalled();
  });
});
