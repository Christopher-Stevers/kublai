// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { DocumentState } from "~/server/documents/types";
import type { DocumentAccess } from "~/server/documents/access";
import type { DocumentActor } from "~/server/documents/domain";
const mock = vi.hoisted(() => ({
  userId: "writer" as string | null,
  canWrite: true,
  jobId: "",
  documentId: "",
  workspace: null as DocumentState | null,
}));
vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: () => ({ userId: mock.userId }),
}));
vi.mock("~/server/documents/access", () => ({
  assertDocumentAccess: (userId: string, jobId: string) => {
    if (jobId !== mock.jobId)
      throw new TRPCError({ code: "NOT_FOUND", message: "Job not found." });
    return {
      user: { id: userId },
      job: { id: jobId, organizationId: "org" },
      canWrite: mock.canWrite,
      canManage: false,
    };
  },
  documentActor: (access: DocumentAccess) => ({
    userId: access.user.id,
    jobId: access.job.id,
    canWrite: access.canWrite,
    canManage: access.canManage,
    memberIds: [access.user.id],
  }),
}));
vi.mock("~/server/documents/service", () => ({
  readWorkspace: () => Promise.resolve(structuredClone(mock.workspace)),
  mutateWorkspace: async (
    userId: string,
    jobId: string,
    mutation: (state: DocumentState, actor: DocumentActor) => unknown,
  ) => {
    const draft = structuredClone(mock.workspace!);
    const result = await mutation(draft, {
      userId,
      jobId,
      canWrite: mock.canWrite,
      canManage: false,
      memberIds: [userId],
    });
    mock.workspace = draft;
    return result;
  },
}));
import { appendVersion, emptyDocumentState } from "~/server/documents/domain";
import {
  completeEditorSaveReceipt,
  EDITOR_SAVE_RECEIPT_TTL_MS,
} from "~/server/documents/editor-save-receipt";
import { GET, POST } from "./route";
function input() {
  return {
    jobId: mock.jobId,
    documentId: mock.documentId,
    requestId: randomUUID(),
  };
}
const url = "https://app.example.com/api/job-documents/editor/save";
const post = (body: unknown, headers?: Record<string, string>) =>
  POST(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
const get = (query: Record<string, string>, headers?: Record<string, string>) =>
  GET(new Request(`${url}?${new URLSearchParams(query)}`, { headers }));
beforeEach(() => {
  mock.userId = "writer";
  mock.canWrite = true;
  mock.jobId = randomUUID();
  mock.workspace = emptyDocumentState();
  mock.documentId = appendVersion(
    mock.workspace,
    {
      userId: "writer",
      jobId: mock.jobId,
      canWrite: true,
      canManage: false,
      memberIds: ["writer"],
    },
    {
      name: "Report.docx",
      mimeType: "application/zip",
      size: 4,
      sha256: "a".repeat(64),
    },
  ).documentId;
});
describe("authenticated durable editor save API", () => {
  it("registers idempotently and returns request-specific pending/committed receipts without caching", async () => {
    const query = input();
    const response = await post(query);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      requestId: query.requestId,
      status: "pending",
    });
    expect((await post(query)).status).toBe(200);
    expect(mock.workspace!.editorSaveReceipts).toHaveLength(1);
    expect(await (await get(query)).json()).toEqual({
      requestId: query.requestId,
      status: "pending",
    });
    const versionId = mock.workspace!.versions[0]!.id;
    completeEditorSaveReceipt(
      mock.workspace!,
      {
        userId: "writer",
        jobId: mock.jobId,
        canWrite: true,
        canManage: false,
        memberIds: ["writer"],
      },
      mock.documentId,
      versionId,
      JSON.stringify({ foremanhqSaveRequestId: query.requestId }),
    );
    const committed = (await (await get(query)).json()) as Record<
      string,
      unknown
    >;
    expect(committed).toMatchObject({
      requestId: query.requestId,
      status: "committed",
      versionId,
    });
    expect(typeof committed.committedAt).toBe("string");
  });
  it("requires app identity and same origin for registration and polling", async () => {
    const query = input();
    for (const operation of [post, get]) {
      expect(
        (await operation(query, { origin: "https://attacker.example.com" }))
          .status,
      ).toBe(403);
      expect(
        (await operation(query, { "sec-fetch-site": "cross-site" })).status,
      ).toBe(403);
    }
    mock.userId = null;
    expect((await post(query)).status).toBe(401);
    expect((await get(query)).status).toBe(401);
    expect(mock.workspace!.editorSaveReceipts).toBeUndefined();
  });
  it("hides receipts from other owners, documents and jobs and checks current document visibility", async () => {
    const query = input();
    await post(query);
    mock.userId = "other";
    expect((await get(query)).status).toBe(404);
    expect((await post(query)).status).toBe(404);
    mock.userId = "writer";
    expect((await get({ ...query, documentId: randomUUID() })).status).toBe(
      404,
    );
    expect((await get({ ...query, jobId: randomUUID() })).status).toBe(404);
    const folderId = randomUUID();
    mock.workspace!.folders.push({
      id: folderId,
      parentId: null,
      name: "Private",
      permissions: [{ userId: "other", role: "manager" }],
      createdBy: "other",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mock.workspace!.documents[0]!.folderId = folderId;
    expect((await get(query)).status).toBe(404);
    expect((await post({ ...query, requestId: randomUUID() })).status).toBe(
      404,
    );
  });
  it("refuses readonly, other-user locked and linked documents without creating intents", async () => {
    mock.canWrite = false;
    expect((await post(input())).status).toBe(403);
    mock.canWrite = true;
    mock.workspace!.documents[0]!.lockedBy = "other";
    expect((await post(input())).status).toBe(409);
    mock.workspace!.documents[0]!.lockedBy = null;
    mock.workspace!.documents[0]!.officeWebUrl =
      "https://tenant.sharepoint.com/file.docx";
    expect((await post(input())).status).toBe(400);
    expect(mock.workspace!.editorSaveReceipts).toBeUndefined();
  });
  it("expires old receipts without reporting generic current-version changes as saved", async () => {
    const query = input();
    await post(query);
    mock.workspace!.editorSaveReceipts![0]!.expiresAt = new Date(
      Date.now() - EDITOR_SAVE_RECEIPT_TTL_MS,
    ).toISOString();
    expect((await get(query)).status).toBe(404);
    expect((await post(query)).status).toBe(404);
  });
  it("rejects malformed, oversized, non-JSON and unrecognized input", async () => {
    expect((await post({ ...input(), userId: "other" })).status).toBe(400);
    expect(
      (await post({ ...input(), requestId: "a".repeat(5000) })).status,
    ).toBe(413);
    expect((await post(input(), { "content-type": "text/plain" })).status).toBe(
      400,
    );
    expect(
      (
        await POST(
          new Request(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
    expect((await get({ ...input(), userId: "other" })).status).toBe(400);
    expect(mock.workspace!.editorSaveReceipts).toBeUndefined();
  });
});
