// @vitest-environment node
import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendVersion,
  emptyDocumentState,
  type DocumentActor,
} from "./domain";
import type * as DocumentStorage from "./storage";
import { defaultSubmittal } from "~/lib/submittals";
const mock = vi.hoisted(() => ({
  access: vi.fn(),
  save: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  identity: vi.fn(),
}));
vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: mock.identity,
}));
vi.mock("./access", () => ({
  assertDocumentAccess: mock.access,
  documentActor: (access: { actor: DocumentActor }) => access.actor,
}));
vi.mock("./service", () => ({
  readWorkspace: mock.read,
  saveDocumentVersion: mock.save,
}));
vi.mock("./storage", async (original) => ({
  ...(await original<typeof DocumentStorage>()),
  writeDocumentBlob: mock.write,
}));
import { POST } from "~/app/api/job-documents/upload/route";
const jobId = randomUUID();
let state = emptyDocumentState();
const actor: DocumentActor = {
  userId: "editor",
  jobId,
  canWrite: true,
  canManage: true,
  memberIds: ["editor"],
};
function request(
  bytes = "%PDF-1.7\n%%EOF",
  fields: Record<string, string> = {},
  name = "Product.pdf",
) {
  const body = new FormData();
  body.append("file", new Blob([bytes], { type: "application/pdf" }), name);
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return new Request(
    `https://hq.example.com/api/job-documents/upload?jobId=${jobId}`,
    { method: "POST", headers: { origin: "https://hq.example.com" }, body },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  state = emptyDocumentState();
  mock.identity.mockResolvedValue({ userId: actor.userId });
  mock.access.mockResolvedValue({
    canWrite: true,
    actor,
    job: { id: jobId, organizationId: randomUUID() },
  });
  mock.read.mockImplementation(async () => structuredClone(state));
  mock.write.mockResolvedValue("blob");
  mock.save.mockImplementation(
    async (
      _access: unknown,
      input: Parameters<typeof appendVersion>[2],
      persist: () => Promise<unknown>,
    ) => {
      const working = structuredClone(state);
      const result = appendVersion(working, actor, input);
      await persist();
      state = working;
      return result;
    },
  );
});

describe("Submittal multipart boundary", () => {
  it("publishes a byte-verified PDF and metadata together, and rejects renamed non-PDF bytes", async () => {
    const metadata = JSON.stringify(defaultSubmittal("Product.pdf"));
    expect(
      (await POST(request("<script>bad</script>", { submittal: metadata })))
        .status,
    ).toBe(400);
    expect(mock.write).not.toHaveBeenCalled();
    expect(state.documents).toEqual([]);
    const response = await POST(request(undefined, { submittal: metadata }));
    expect(response.status).toBe(200);
    expect(state.documents[0]?.submittal).toMatchObject({
      number: "SUB-001",
      title: "Product",
    });
    expect(state.versions[0]?.mimeType).toBe("application/pdf");
    expect(mock.write).toHaveBeenCalledTimes(1);
  });
  it("does not publish metadata or consume references if blob storage fails", async () => {
    mock.write.mockRejectedValueOnce(new Error("Disk unavailable"));
    expect(
      (
        await POST(
          request(undefined, {
            submittal: JSON.stringify(defaultSubmittal("Product.pdf")),
          }),
        )
      ).status,
    ).toBe(500);
    expect(state.documents).toEqual([]);
    expect(
      (
        await POST(
          request(undefined, {
            submittal: JSON.stringify(defaultSubmittal("Product.pdf")),
          }),
        )
      ).status,
    ).toBe(200);
    expect(state.documents[0]?.submittal?.number).toBe("SUB-001");
  });
  it("rejects invalid metadata before persisting and rechecks access after receiving bytes", async () => {
    expect((await POST(request(undefined, { submittal: "{" }))).status).toBe(
      400,
    );
    expect(mock.save).not.toHaveBeenCalled();
    mock.access.mockResolvedValueOnce({
      canWrite: true,
      actor,
      job: { id: jobId, organizationId: randomUUID() },
    });
    mock.access.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN", message: "Access revoked" }),
    );
    expect((await POST(request())).status).toBe(403);
    expect(mock.save).not.toHaveBeenCalled();
  });
  it("keeps revisions PDF-only and rejects stale version IDs", async () => {
    const original = appendVersion(state, actor, {
      name: "Product.pdf",
      mimeType: "application/pdf",
      sha256: "a".repeat(64),
      size: 20,
      submittal: defaultSubmittal("Product.pdf"),
    });
    const fields = {
      documentId: original.documentId,
      expectedVersionId: original.versionId,
    };
    expect((await POST(request("not a PDF", fields))).status).toBe(400);
    expect(mock.write).not.toHaveBeenCalled();
    expect(
      (
        await POST(
          request(undefined, { ...fields, expectedVersionId: randomUUID() }),
        )
      ).status,
    ).toBe(409);
    expect(state.versions).toHaveLength(1);
    expect((await POST(request(undefined, fields))).status).toBe(200);
    expect(state.versions).toHaveLength(2);
    expect(state.documents[0]?.submittal?.number).toBe("SUB-001");
  });
});
