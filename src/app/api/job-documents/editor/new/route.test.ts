// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { DocumentState } from "~/server/documents/types";
import type { DocumentAccess } from "~/server/documents/access";
import type * as DocumentStorage from "~/server/documents/storage";
const state = vi.hoisted(() => ({
  userId: "writer" as string | null,
  canWrite: true,
  jobId: "",
  workspace: null as DocumentState | null,
  persist: vi.fn(),
  configured: true,
}));
vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: () => ({ userId: state.userId }),
}));
vi.mock("~/server/documents/access", () => ({
  assertDocumentAccess: (userId: string | null, jobId: string) => {
    if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
    if (jobId !== state.jobId)
      throw new TRPCError({ code: "NOT_FOUND", message: "Job not found." });
    return {
      user: { id: userId },
      job: { id: jobId, organizationId: "org" },
      canWrite: state.canWrite,
      canManage: false,
    };
  },
}));
vi.mock("~/server/documents/editor-config", () => ({
  getDocumentEditorConfig: () => {
    if (!state.configured)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Editor not configured.",
      });
  },
}));
vi.mock("~/server/documents/storage", async (original) => ({
  ...(await original<typeof DocumentStorage>()),
  writeDocumentBlob: state.persist,
}));
vi.mock("~/server/documents/service", async () => {
  const { appendVersion } = await import("~/server/documents/domain");
  return {
    saveDocumentVersion: async (
      access: DocumentAccess,
      input: Parameters<typeof appendVersion>[2],
      persist: () => Promise<unknown>,
    ) => {
      const draft = structuredClone(state.workspace!);
      const result = appendVersion(
        draft,
        {
          userId: access.user.id,
          jobId: access.job.id,
          canWrite: access.canWrite,
          canManage: access.canManage,
          memberIds: [access.user.id],
        },
        input,
      );
      await persist();
      state.workspace = draft;
      return result;
    },
  };
});
import { emptyDocumentState } from "~/server/documents/domain";
import { POST } from "./route";
const request = (input: unknown, headers?: Record<string, string>) =>
  new Request("https://app.example.com/api/job-documents/editor/new", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(input),
  });
beforeEach(() => {
  state.userId = "writer";
  state.canWrite = true;
  state.jobId = randomUUID();
  state.workspace = emptyDocumentState();
  state.persist.mockReset().mockResolvedValue("sha");
  state.configured = true;
});
describe("Blank document creation endpoint", () => {
  it("creates a real immutable version and refuses readonly members without writing a blob", async () => {
    const response = await POST(
      request({ jobId: state.jobId, name: "Report", kind: "word" }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(state.workspace!.documents[0]).toMatchObject({
      name: "Report.docx",
      createdBy: "writer",
    });
    expect(state.workspace!.versions[0]).toMatchObject({
      number: 1,
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    state.canWrite = false;
    state.persist.mockClear();
    expect(
      (
        await POST(
          request({ jobId: state.jobId, name: "No write", kind: "word" }),
        )
      ).status,
    ).toBe(403);
    expect(state.persist).not.toHaveBeenCalled();
  });
  it("enforces folder access and collision checks before blob persistence", async () => {
    const folderId = randomUUID();
    state.workspace!.folders.push({
      id: folderId,
      parentId: null,
      name: "Private",
      permissions: [{ userId: "another", role: "manager" }],
      createdBy: "another",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(
      (
        await POST(
          request({
            jobId: state.jobId,
            folderId,
            name: "Report",
            kind: "word",
          }),
        )
      ).status,
    ).toBe(404);
    expect(state.persist).not.toHaveBeenCalled();
    await POST(request({ jobId: state.jobId, name: "Report", kind: "word" }));
    state.persist.mockClear();
    expect(
      (
        await POST(
          request({ jobId: state.jobId, name: "Report", kind: "word" }),
        )
      ).status,
    ).toBe(409);
    expect(state.persist).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated, foreign job and cross-origin requests", async () => {
    expect(
      (
        await POST(
          request({ jobId: randomUUID(), name: "Report", kind: "word" }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await POST(
          request(
            { jobId: state.jobId, name: "Report", kind: "word" },
            { origin: "https://attacker.example.com" },
          ),
        )
      ).status,
    ).toBe(403);
    state.userId = null;
    expect(
      (
        await POST(
          request({ jobId: state.jobId, name: "Report", kind: "word" }),
        )
      ).status,
    ).toBe(401);
    expect(state.persist).not.toHaveBeenCalled();
  });
  it("bounds JSON input, rejects malformed JSON/non-JSON/unknown fields and returns setup errors clearly", async () => {
    expect(
      (
        await POST(
          request({ jobId: state.jobId, name: "a".repeat(5000), kind: "word" }),
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await POST(
          new Request("https://app.example.com/api", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request(
            { jobId: state.jobId, name: "Report", kind: "word" },
            { "content-type": "text/plain" },
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request({
            jobId: state.jobId,
            name: "Report",
            kind: "word",
            userId: "other",
          }),
        )
      ).status,
    ).toBe(400);
    state.configured = false;
    expect(
      (
        await POST(
          request({ jobId: state.jobId, name: "Report", kind: "word" }),
        )
      ).status,
    ).toBe(503);
    expect(state.persist).not.toHaveBeenCalled();
  });
});
