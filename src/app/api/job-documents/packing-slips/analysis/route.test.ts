// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  clear: vi.fn(),
  refresh: vi.fn(),
  confirm: vi.fn(),
  access: vi.fn(),
}));
vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: async () => ({ userId: "receiver" }),
}));
vi.mock("~/server/documents/access", () => ({
  assertDocumentAccess: mocks.access,
}));
vi.mock("~/server/packing-slips/service", () => ({
  startSlipAnalysis: mocks.start,
  clearSlipAnalysis: mocks.clear,
  refreshSlipReview: mocks.refresh,
  confirmSlipReceipt: mocks.confirm,
}));
import { POST } from "./route";
const id = "00000000-0000-4000-8000-000000000001";
const access = { user: { id: "receiver" }, job: { id } };
const request = (action: string, runId: string | undefined = id) =>
  new Request("http://localhost/api/job-documents/packing-slips/analysis", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ action, jobId: id, documentId: id, runId }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue(access);
});
it("clears only the requested authorized slip and returns an uncached response", async () => {
  const response = await POST(request("clear"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.clear).toHaveBeenCalledWith(access, id, id);
  expect(mocks.start).not.toHaveBeenCalled();
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it("forwards the expected run when rerunning detection", async () => {
  expect((await POST(request("analyze"))).status).toBe(200);
  expect(mocks.start).toHaveBeenCalledWith(access, id, true, id);
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it("rejects a clear without a run ID", async () => {
  const response = await POST(
    new Request(request("clear"), {
      body: JSON.stringify({ action: "clear", jobId: id, documentId: id }),
    }),
  );
  expect(response.status).toBe(400);
  expect(mocks.clear).not.toHaveBeenCalled();
});
it("rejects cross-origin detection changes", async () => {
  const response = await POST(
    new Request(request("clear"), {
      headers: {
        origin: "https://elsewhere.example",
        "content-type": "application/json",
      },
    }),
  );
  expect(response.status).toBe(403);
  expect(mocks.clear).not.toHaveBeenCalled();
  expect(mocks.access).not.toHaveBeenCalled();
});
