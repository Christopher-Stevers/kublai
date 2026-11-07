// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  access: vi.fn(),
  model: vi.fn(),
  stream: vi.fn(),
}));
vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: mocks.identity,
}));
vi.mock("~/server/models/access", () => ({ modelAccess: mocks.access }));
vi.mock("~/server/models/service", () => ({ readModel: mocks.model }));
vi.mock("~/server/models/storage", () => ({
  modelBlobPath: () => "/test.ifc",
}));
vi.mock("node:fs/promises", () => ({
  stat: () => Promise.resolve({ size: 123 }),
}));
vi.mock("node:fs", () => ({ createReadStream: mocks.stream }));
import { HEAD } from "./route";
const id = "00000000-0000-4000-8000-000000000001";
const request = () =>
  new Request(`https://app.test/api/models/files/${id}?jobId=${id}`, {
    method: "HEAD",
  });
const params = { params: Promise.resolve({ modelId: id }) };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue({ userId: "user" });
  mocks.access.mockResolvedValue({ job: { organizationId: "org" } });
  mocks.model.mockResolvedValue({
    viewSha: "content-hash",
    data: { name: "Tower" },
  });
});
it("checks access and returns the content version without reading model bytes", async () => {
  const result = await HEAD(request(), params);
  expect(result.status).toBe(200);
  expect(result.headers.get("etag")).toBe('"content-hash"');
  expect(result.headers.get("content-length")).toBe("123");
  expect(result.body).toBeNull();
  expect(mocks.access).toHaveBeenCalledWith("user", id);
  expect(mocks.stream).not.toHaveBeenCalled();
});
it("denies the version check when access has been revoked", async () => {
  mocks.access.mockRejectedValue(new TRPCError({ code: "FORBIDDEN" }));
  const result = await HEAD(request(), params);
  expect(result.status).toBe(403);
  expect(result.headers.get("etag")).toBeNull();
  expect(mocks.model).not.toHaveBeenCalled();
});

it("returns a partial response when If-Range matches the model version", async () => {
  const req = new Request(
    `https://app.test/api/models/files/${id}?jobId=${id}`,
    {
      method: "HEAD",
      headers: { range: "bytes=40-", "if-range": '"content-hash"' },
    },
  );
  const response = await HEAD(req, params);
  expect(response.status).toBe(206);
  expect(response.headers.get("content-range")).toBe("bytes 40-122/123");
  expect(response.headers.get("content-length")).toBe("83");
});
it("ignores Range after the model version changes", async () => {
  const req = new Request(
    `https://app.test/api/models/files/${id}?jobId=${id}`,
    {
      method: "HEAD",
      headers: { range: "bytes=40-", "if-range": '"old-hash"' },
    },
  );
  const response = await HEAD(req, params);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-range")).toBeNull();
  expect(response.headers.get("content-length")).toBe("123");
});
