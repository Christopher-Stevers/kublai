// @vitest-environment node
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql, getTableColumns, getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { PDFDocument } from "pdf-lib";
import { drawingSaveSchema } from "~/lib/drawing-workspace";
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("./storage", () => ({ readDocumentBlob: vi.fn() }));
import * as schema from "~/server/db/schema";
import * as workspaceTables from "~/server/db/drawing-workspace-schema";
import { emptyDocumentState } from "./domain";
import { readDocumentBlob } from "./storage";
import { openDocumentDrawingWorkspace } from "./drawing-workspace";
import {
  getDrawingWorkspace,
  listDrawingWorkspace,
  saveDrawingEntity,
} from "~/server/drawings/service";
import { drawingsRouter } from "~/server/api/routers/drawings";
import { toStoredConfig } from "~/server/auth/permissions";

const socket = process.env.DOC_DRAWING_TEST_SOCKET;
const conn = postgres({
  host: socket ?? "/tmp/no-doc-drawing-db",
  port: 55464,
  database: "document_drawings_integration",
  max: 4,
});
const db = drizzle(conn, { schema });
const org = randomUUID(),
  jobId = randomUUID(),
  documentId = randomUUID(),
  versionId = randomUUID(),
  folderId = randomUUID();
const ctx = { db, userId: "editor" };
const state = emptyDocumentState();
const now = new Date().toISOString();
state.folders.push({
  id: folderId,
  parentId: null,
  name: "Private",
  createdAt: now,
  updatedAt: now,
  createdBy: "editor",
  permissions: [{ userId: "editor", role: "manager" }],
} as never);
state.documents.push({
  id: documentId,
  jobId,
  folderId,
  name: "Specification.pdf",
  currentVersionId: versionId,
  deletedAt: null,
  lockedBy: null,
} as never);
state.versions.push({
  id: versionId,
  documentId,
  name: "Specification.pdf",
  mimeType: "application/pdf",
  sha256: "a".repeat(64),
  number: 1,
} as never);
async function storeState() {
  await db
    .update(schema.jobDocumentWorkspaces)
    .set({ state })
    .where(eq(schema.jobDocumentWorkspaces.jobId, jobId));
}

beforeAll(async () => {
  if (!socket) return;
  if (!socket.startsWith("/tmp/foremanhq-doc-drawings-pg."))
    throw Error("Refusing a non-isolated database");
  const tables = [
    schema.users,
    schema.jobs,
    schema.jobDocumentWorkspaces,
    schema.jobDrawingSets,
    schema.jobDrawingSheets,
    workspaceTables.drawingWorkspaceEntities,
    workspaceTables.drawingWorkspaceMetadata,
    workspaceTables.drawingWorkspaceFavorites,
    workspaceTables.drawingWorkspaceActivity,
    workspaceTables.drawingWorkspaceWatches,
  ];
  for (const raw of tables) {
    const table = raw as PgTable;
    const columns = Object.values(getTableColumns(table));
    const fields = columns.map(
      (column) =>
        `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}`,
    );
    await conn.unsafe(
      `CREATE TABLE "${getTableName(table)}" (${fields.join(",")})`,
    );
  }
  await conn`CREATE UNIQUE INDEX document_workspace_key ON kublai_job_document_workspace ("jobId", "organizationId")`;
  await conn`CREATE UNIQUE INDEX favorite_key ON kublai_drawing_workspace_favorite ("sheetId", "userId")`;
  await conn`CREATE UNIQUE INDEX watch_key ON kublai_drawing_workspace_watch ("sheetId", "userId")`;
  const migration = await readFile(
    new URL(
      "../../../drizzle/0075_document_drawing_workspace.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await conn.unsafe(migration);
  await conn.unsafe(migration);
  for (const user of ["editor", "outsider"])
    await db.insert(schema.users).values({
      id: user,
      name: user,
      email: `${user}@example.test`,
      role: user === "editor" ? "admin" : "worker",
      organizationId: org,
      organizationAccessStatus: "approved",
      permissionConfig: toStoredConfig({
        "drawings.view": user !== "editor",
        "drawings.delete": true,
      }),
    });
  await db
    .insert(schema.jobs)
    .values({ id: jobId, name: "Test", organizationId: org });
  await db
    .insert(schema.jobDocumentWorkspaces)
    .values({ jobId, organizationId: org, state });
  const pdf = await PDFDocument.create();
  pdf.addPage([600, 800]);
  pdf.addPage([1000, 500]);
  vi.mocked(readDocumentBlob).mockResolvedValue(Buffer.from(await pdf.save()));
});
afterAll(async () => {
  await conn.end();
});

it.skipIf(!socket)(
  "opens stable private page identities, persists markups, isolates versions, and rechecks document ACLs",
  async () => {
    const [pages, concurrent] = await Promise.all([
      openDocumentDrawingWorkspace(ctx, { jobId, versionId }),
      openDocumentDrawingWorkspace(ctx, { jobId, versionId }),
    ]);
    expect(pages.map((p) => p.id)).toEqual(concurrent.map((p) => p.id));
    expect(pages.map((p) => [p.width, p.height])).toEqual([
      [600, 800],
      [1000, 500],
    ]);
    const first = pages[0]!;
    const initial = await getDrawingWorkspace(ctx, first.id);
    expect(initial.canAnnotate).toBe(true);
    expect(initial.jobSheets.map((p) => p.id)).toEqual(pages.map((p) => p.id));
    const entityId = randomUUID();
    await saveDrawingEntity(ctx, {
      sheetId: first.id,
      id: entityId,
      expectedRevision: 0,
      kind: "markup",
      visibility: "published",
      data: {
        sourceSheetId: first.id,
        type: "line",
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.5, y: 0.5 },
        ],
        stroke: "#ff0000",
        width: 2,
      },
    });
    expect((await getDrawingWorkspace(ctx, first.id)).entities[0]?.id).toBe(
      entityId,
    );
    expect((await getDrawingWorkspace(ctx, pages[1]!.id)).entities).toEqual([]);
    await expect(
      getDrawingWorkspace({ db, userId: "outsider" }, first.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      openDocumentDrawingWorkspace(
        { db, userId: "outsider" },
        { jobId, versionId },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Even a drawing uploader cannot discover the document in ordinary drawing lists.
    expect(
      await listDrawingWorkspace({ db, userId: "outsider" }, jobId),
    ).toEqual([]);
    const outsider = (
      await db
        .select()
        .from(schema.users)
        .where(sql`id = 'outsider'`)
    )[0];
    const caller = drawingsRouter.createCaller({
      db,
      userId: "outsider",
      user: outsider,
    } as never);
    expect((await caller.listSets({ jobId })).sets).toEqual([]);
    await expect(caller.getSet({ setId: first.setId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      caller.deleteSheet({ sheetId: first.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // New document revisions receive fresh annotation identities; old marks remain on the old version.
    const nextVersion = randomUUID();
    state.versions.push({ ...state.versions[0]!, id: nextVersion, number: 2 });
    state.documents[0]!.currentVersionId = nextVersion;
    await storeState();
    const revised = await openDocumentDrawingWorkspace(ctx, {
      jobId,
      versionId: nextVersion,
    });
    expect(revised[0]!.id).not.toBe(first.id);
    expect((await getDrawingWorkspace(ctx, revised[0]!.id)).entities).toEqual(
      [],
    );
    expect((await getDrawingWorkspace(ctx, first.id)).canAnnotate).toBe(false);
    const saved = (await getDrawingWorkspace(ctx, first.id)).entities[0]!;
    await expect(
      saveDrawingEntity(
        ctx,
        drawingSaveSchema.parse({ ...saved, expectedRevision: saved.revision }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    state.folders[0]!.permissions.push({ userId: "outsider", role: "viewer" });
    await storeState();
    expect(
      (await getDrawingWorkspace({ db, userId: "outsider" }, revised[0]!.id))
        .canAnnotate,
    ).toBe(false);
    state.folders[0]!.permissions = [{ userId: "editor", role: "manager" }];
    await storeState();
    await expect(
      getDrawingWorkspace({ db, userId: "outsider" }, revised[0]!.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    state.documents[0]!.lockedBy = "another-editor";
    await storeState();
    expect((await getDrawingWorkspace(ctx, revised[0]!.id)).canAnnotate).toBe(
      false,
    );
    // Revocation and recycle checks apply even after pages were already created.
    state.documents[0]!.deletedAt = now;
    await storeState();
    await expect(getDrawingWorkspace(ctx, first.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  },
);
