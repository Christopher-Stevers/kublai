// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mock = vi.hoisted(() => ({
  user: {
    id: "alice",
    organizationId: "org-a",
    organizationAccessStatus: "approved",
  } as {
    id: string;
    organizationId: string;
    organizationAccessStatus: string;
  } | null,
  permitted: true,
  rows: [] as unknown[][],
  where: vi.fn<(where: SQL) => { limit: () => Promise<unknown[]> }>(),
  select: vi.fn(),
  write: vi.fn(),
  info: vi.fn(),
  read: vi.fn(),
}));
vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: async () => ({ user: mock.user }),
}));
vi.mock("~/server/auth/permissions", () => ({ userCan: () => mock.permitted }));
vi.mock("~/server/db", () => ({ db: { select: mock.select } }));
vi.mock("~/server/drawings/attachments", () => ({
  MAX_DRAWING_ATTACHMENT_BYTES: 10 * 1024 * 1024,
  withDrawingAttachmentSlot: async (action: () => Promise<unknown>) => action(),
  writeDrawingAttachment: mock.write,
  drawingAttachmentInfo: mock.info,
  readDrawingAttachment: mock.read,
}));
import { POST } from "./route";
import { GET } from "./[jobId]/[fileId]/route";

const jobId = "0391aed4-7773-47ec-9141-09df373ec008";
const sheetId = "d814fc88-da7c-4df5-aa89-fe3c1fde0462";
const fileId = "1aab7b52-3c29-43da-baba-86884869f52c";
const path = `/api/drawings/attachments/${jobId}/${fileId}`;
const context = { params: Promise.resolve({ jobId, fileId }) };
const post = (headers: Record<string, string> = {}) =>
  new Request(
    `https://app.test/api/drawings/attachments?sheetId=${sheetId}&name=Photo.jpg`,
    { method: "POST", headers, body: "photo" },
  );
const get = () => GET(new Request(`https://app.test${path}`), context);
beforeEach(() => {
  vi.clearAllMocks();
  mock.user = {
    id: "alice",
    organizationId: "org-a",
    organizationAccessStatus: "approved",
  };
  mock.permitted = true;
  mock.rows = [[{ jobId, id: sheetId }]];
  mock.where.mockImplementation(() => ({
    limit: async () => mock.rows.shift() ?? [],
  }));
  mock.select.mockImplementation(() => ({
    from: () => ({ where: mock.where }),
  }));
  mock.write.mockResolvedValue({
    url: path,
    name: "Photo.webp",
    mime: "image/webp",
  });
  mock.info.mockResolvedValue({ sheetId, authorId: "alice" });
  mock.read.mockResolvedValue({
    bytes: Buffer.from("photo"),
    name: "Photo.webp",
    mime: "image/webp",
  });
});

describe("private drawing attachments", () => {
  it("rejects unauthenticated, unapproved, and unauthorized accounts before file or database access", async () => {
    mock.user = null;
    expect((await POST(post())).status).toBe(403);
    expect((await get()).status).toBe(403);
    mock.user = {
      id: "alice",
      organizationId: "org-a",
      organizationAccessStatus: "pending",
    };
    expect((await get()).status).toBe(403);
    mock.user.organizationAccessStatus = "approved";
    mock.permitted = false;
    expect((await POST(post())).status).toBe(403);
    expect(mock.select).not.toHaveBeenCalled();
    expect(mock.info).not.toHaveBeenCalled();
    expect(mock.write).not.toHaveBeenCalled();
  });

  it("requires same-origin upload and bounds the body before converting or storing", async () => {
    expect((await POST(post({ origin: "https://other.test" }))).status).toBe(
      403,
    );
    expect(mock.select).not.toHaveBeenCalled();
    expect(
      (await POST(post({ "content-length": String(10 * 1024 * 1024 + 1) })))
        .status,
    ).toBe(413);
    expect(mock.write).not.toHaveBeenCalled();
  });

  it("binds upload identity and sheet organization server-side", async () => {
    expect((await POST(post())).status).toBe(200);
    expect(mock.write).toHaveBeenCalledWith(
      expect.objectContaining({
        authorId: "alice",
        jobId,
        sheetId,
        bytes: Buffer.from("photo"),
      }),
    );
    const query = new PgDialect().sqlToQuery(mock.where.mock.calls[0]![0]);
    expect(query.params).toEqual([sheetId, "org-a"]);
    mock.rows = [[]];
    expect((await POST(post())).status).toBe(404);
    expect(mock.write).toHaveBeenCalledOnce();
  });

  it("never serves bytes if the sheet belongs to a different job or organization", async () => {
    mock.rows = [[]];
    expect((await get()).status).toBe(404);
    const query = new PgDialect().sqlToQuery(mock.where.mock.calls[0]![0]);
    expect(query.params).toEqual([sheetId, jobId, "org-a"]);
    expect(mock.read).not.toHaveBeenCalled();
  });

  it("requires a visible issue reference for non-authors", async () => {
    mock.info.mockResolvedValue({ sheetId, authorId: "bob" });
    mock.rows = [[{ id: sheetId }], []];
    expect((await get()).status).toBe(404);
    expect(mock.read).not.toHaveBeenCalled();
    const scope = new PgDialect().sqlToQuery(mock.where.mock.calls[1]![0]);
    expect(scope.sql).toContain("'published'");
    expect(scope.params).toEqual([
      jobId,
      "org-a",
      "alice",
      JSON.stringify([{ url: path }]),
    ]);
    mock.rows = [[{ id: sheetId }], [{ id: "issue" }]];
    expect((await get()).status).toBe(200);
    expect(mock.read).toHaveBeenCalledOnce();
  });

  it("serves PDFs as private non-sniffable sandboxed downloads", async () => {
    mock.read.mockResolvedValue({
      bytes: Buffer.from("%PDF-test"),
      name: "Plan.pdf",
      mime: "application/pdf",
    });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment/);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "sandbox",
    );
  });
});
