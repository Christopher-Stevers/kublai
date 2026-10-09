// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { DrawingContext } from "./service";
import type { DocumentState } from "~/server/documents/types";
import { emptyDocumentState } from "~/server/documents/domain";
const mock = vi.hoisted(() => ({
  access: vi.fn(),
  manage: false,
  queries: [] as SQL[],
  rows: [] as unknown[][],
  select: vi.fn(),
}));
vi.mock("./service", () => ({ accessSheet: mock.access }));
vi.mock("~/server/auth/permissions", () => ({
  userCan: () => mock.manage,
  hasManagingSeat: () => mock.manage,
}));
import { drawingLinkTargets } from "./link-targets";
const ctx = {
  userId: "alice",
  db: { select: mock.select },
} as unknown as DrawingContext;
const input = { sheetId: "source", kind: "document" as const, query: "" };
beforeEach(() => {
  vi.clearAllMocks();
  mock.manage = false;
  mock.queries = [];
  mock.access.mockResolvedValue({
    sheet: { jobId: "job" },
    actor: { id: "alice", organizationId: "org" },
    user: { id: "alice" },
  });
  mock.rows = [[{ id: "job", name: "Job" }], [{ id: "job", name: "Job" }]];
  mock.select.mockImplementation(() => {
    const rows = mock.rows.shift() ?? [];
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: (where: SQL) => {
        mock.queries.push(where);
        return chain;
      },
      orderBy: () => chain,
      limit: async () => rows,
    };
    return chain;
  });
});
const query = (index: number) =>
  new PgDialect().sqlToQuery(mock.queries[index]!);
function documents(): DocumentState {
  const state = emptyDocumentState();
  state.folders = [
    {
      id: "private",
      parentId: null,
      name: "Private",
      permissions: [{ userId: "bob", role: "viewer" }],
      createdBy: "bob",
      createdAt: "",
      updatedAt: "",
    },
  ];
  state.documents = ["public", "photo", "private", "deleted"].map((id) => ({
    id,
    jobId: "job",
    folderId: id === "private" ? "private" : null,
    name: id,
    description: "",
    tags: [],
    status: "draft",
    currentVersionId: id,
    officeWebUrl: null,
    lockedBy: null,
    deletedAt: id === "deleted" ? "date" : null,
    createdBy: "bob",
    createdAt: "",
    updatedAt: "",
  }));
  state.versions = state.documents.map((doc) => ({
    id: doc.id,
    documentId: doc.id,
    number: 1,
    name: doc.name,
    size: 1,
    mimeType: doc.id === "photo" ? "image/png" : "application/pdf",
    sha256: "",
    createdBy: "bob",
    createdAt: "",
    restoredFromVersionId: null,
  }));
  return state;
}
describe("accessible drawing link resource picker", () => {
  it("checks the drawing access and restricts the target job to the same organization", async () => {
    mock.rows = [[{ id: "job", name: "Job" }], []];
    await expect(
      drawingLinkTargets(ctx, { ...input, jobId: "other-organization-job" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mock.access).toHaveBeenCalledWith(ctx.db, "alice", "source");
    expect(query(0).params).toEqual(["org"]);
    expect(query(1).params).toEqual(["other-organization-job", "org"]);
    expect(mock.select).toHaveBeenCalledTimes(2);
  });
  it("returns readable active documents without exposing restricted or recycled files", async () => {
    mock.rows.push([{ state: documents() }]);
    const result = await drawingLinkTargets(ctx, input);
    expect(result.targets.map((item) => item.label)).toEqual([
      "public",
      "photo",
    ]);
    expect(result.targets[0]?.url).toBe(
      "/dashboard/jobs/job/documents?document=public",
    );
    expect(query(2).params).toEqual(["job", "org"]);
  });
  it("uses inherited document manager permissions and still excludes recycled files", async () => {
    mock.manage = true;
    mock.rows.push([{ state: documents() }]);
    const result = await drawingLinkTargets(ctx, {
      ...input,
      query: "private",
    });
    expect(result.targets.map((item) => item.label)).toEqual(["private"]);
  });
  it("lists document images and posted chat photos with deleted messages excluded", async () => {
    mock.rows.push(
      [{ state: documents() }],
      [{ id: "chat-photo", name: "Installation photo" }],
    );
    const result = await drawingLinkTargets(ctx, { ...input, kind: "photo" });
    expect(result.targets.map((item) => item.label)).toEqual([
      "photo",
      "Installation photo",
    ]);
    expect(result.targets[1]?.url).toBe("/api/job-chat/attachments/chat-photo");
    expect(query(3).params).toEqual(["job", "image/%"]);
  });
  it("resolves local sheets in the viewer and other jobs' sheets through authorized pages", async () => {
    mock.rows.push([{ id: "target", setId: "set", name: "A101" }]);
    const local = await drawingLinkTargets(ctx, { ...input, kind: "sheet" });
    expect(local.targets[0]).toMatchObject({ targetSheetId: "target" });
    mock.rows = [
      [{ id: "job", name: "Job" }],
      [{ id: "other", name: "Other" }],
      [{ id: "target", setId: "set", name: "A101" }],
    ];
    const other = await drawingLinkTargets(ctx, {
      ...input,
      kind: "sheet",
      jobId: "other",
    });
    expect(other.targets[0]).toMatchObject({
      url: "/dashboard/jobs/other/drawings?drawingSet=set&drawingSheet=target",
    });
  });
  it("returns material lists and tool requests with their actual destinations", async () => {
    mock.rows.push([{ id: "list", name: "Equipment", kind: "tools" }]);
    const result = await drawingLinkTargets(ctx, {
      ...input,
      kind: "materialList",
    });
    expect(result.targets[0]).toMatchObject({
      description: "Tool request",
      url: "/dashboard/material-lists/list",
    });
    expect(query(2).params).toEqual(["job", "org"]);
  });
});
