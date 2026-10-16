// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  access: vi.fn(),
  preview: vi.fn(),
  rows: vi.fn(),
}));
vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: mocks.identity,
}));
vi.mock("~/server/documents/drawing-workspace", () => ({
  documentDrawingAccess: mocks.access,
}));
vi.mock("~/server/documents/page-preview", () => ({
  documentPagePreview: mocks.preview,
}));
vi.mock("~/server/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.rows }) }) }),
  },
}));
import { GET } from "./route";
const job = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  versionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const context = () => ({ params: Promise.resolve({ versionId, page: "1" }) });
const request = (headers = {}) =>
  new Request(`https://app.test/page?jobId=${job}`, { headers });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({ userId: "member" });
  mocks.access.mockResolvedValue({
    actor: { organizationId: "org" },
    version: { sha256: "hash" },
  });
  mocks.rows.mockResolvedValue([{ width: 1000, height: 500 }]);
  mocks.preview.mockResolvedValue(Buffer.from("real preview"));
});
it("serves preview bytes and validates cached metadata only after fresh ACL and page checks", async () => {
  const image = await GET(request(), context());
  expect(image.headers.get("content-type")).toBe("image/webp");
  expect(await image.text()).toBe("real preview");
  const cached = await GET(
    request({ "if-none-match": image.headers.get("etag")! }),
    context(),
  );
  expect(cached.status).toBe(304);
  expect(mocks.preview).toHaveBeenCalledTimes(1);
  mocks.access.mockRejectedValue(new TRPCError({ code: "FORBIDDEN" }));
  expect(
    (
      await GET(
        request({ "if-none-match": image.headers.get("etag")! }),
        context(),
      )
    ).status,
  ).toBe(403);
  expect(mocks.preview).toHaveBeenCalledTimes(1);
});
it("falls back to a bounded backing when preview preparation fails", async () => {
  mocks.preview.mockRejectedValue(new Error("Unsupported PDF"));
  const response = await GET(request(), context());
  expect(response.headers.get("content-type")).toBe("image/svg+xml");
  expect(await response.text()).toContain('width="1000"');
});
it("does not delay original PDF detail behind a slow preview process", async () => {
  vi.useFakeTimers();
  try {
    mocks.preview.mockReturnValue(new Promise(() => undefined));
    const pending = GET(request(), context());
    await vi.advanceTimersByTimeAsync(501);
    expect((await pending).headers.get("content-type")).toBe("image/svg+xml");
  } finally {
    vi.useRealTimers();
  }
});
