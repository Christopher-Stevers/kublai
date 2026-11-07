// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  access: vi.fn(),
  version: vi.fn(),
  words: vi.fn(),
}));
vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: mocks.identity,
}));
vi.mock("~/server/documents/access", () => ({
  assertDocumentAccess: mocks.access,
}));
vi.mock("~/server/documents/service", () => ({
  readableVersion: mocks.version,
}));
vi.mock("~/server/packing-slips/saved-source-text", () => ({
  savedSlipSourceWords: mocks.words,
}));
import { GET } from "./route";
const job = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  versionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const context = () => ({ params: Promise.resolve({ versionId }) });
const request = () => new Request(`https://app.test/api/source?jobId=${job}`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({ userId: "member" });
  mocks.access.mockResolvedValue({ job: { organizationId: "org" } });
  mocks.version.mockResolvedValue({ version: { sha256: "hash" } });
  mocks.words.mockResolvedValue([
    { page: 1, text: "Copper pipe", x: 0.1, y: 0.2, width: 0.2, height: 0.02 },
  ]);
});
it("checks current job and version ACL before reading stored OCR; prohibits caching", async () => {
  const response = await GET(request(), context());
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(mocks.access).toHaveBeenCalledWith("member", job);
  expect(mocks.version).toHaveBeenCalledWith(
    { job: { organizationId: "org" } },
    versionId,
  );
  expect(mocks.words).toHaveBeenCalledWith("org", "hash");
  expect(await response.json()).toEqual({
    words: [
      {
        page: 1,
        text: "Copper pipe",
        x: 0.1,
        y: 0.2,
        width: 0.2,
        height: 0.02,
      },
    ],
  });
});
it.each(["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"] as const)(
  "does not disclose extraction when ACL rejects %s",
  async (code) => {
    mocks.version.mockRejectedValue(new TRPCError({ code }));
    expect((await GET(request(), context())).status).toBe(
      { UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404 }[code],
    );
    expect(mocks.words).not.toHaveBeenCalled();
  },
);
it("an uncached source returns an empty result without scheduling reading work", async () => {
  mocks.words.mockResolvedValue([]);
  expect(await (await GET(request(), context())).json()).toEqual({ words: [] });
});
