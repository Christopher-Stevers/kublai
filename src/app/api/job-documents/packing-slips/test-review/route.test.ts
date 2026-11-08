import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  access: vi.fn(),
  version: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  readFile: mocks.read,
  default: { readFile: mocks.read },
}));
vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: async () => ({ userId: "user" }),
}));
vi.mock("~/server/documents/access", () => ({
  assertDocumentAccess: mocks.access,
}));
vi.mock("~/server/documents/service", () => ({
  readableVersion: mocks.version,
}));
vi.mock("~/server/documents/http", () => ({
  documentHttpError: () => new Response(null, { status: 403 }),
}));
import { GET } from "./route";
const id = "447413ce-c666-4bb9-b289-4156f4be016a";
const request = () =>
  new Request(`http://localhost/api?jobId=${id}&versionId=${id}`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ job: { organizationId: "org" } });
  mocks.version.mockResolvedValue({ document: { id, packingSlip: {} } });
  mocks.read.mockResolvedValue(
    JSON.stringify({
      documentId: id,
      versionId: id,
      model: "jev-1.14.0",
      rows: [],
    }),
  );
});
it("requires document access before reading private evaluation data", async () => {
  mocks.version.mockRejectedValue(Error());
  expect((await GET(request())).status).toBe(403);
  expect(mocks.read).not.toHaveBeenCalled();
});
it("returns a version-bound private review", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect((await response.json()).review.versionId).toBe(id);
});
it("does not expose an evaluation belonging to another document", async () => {
  mocks.version.mockResolvedValue({
    document: { id: "other", packingSlip: {} },
  });
  expect((await GET(request())).status).toBe(403);
});
it("returns no review when no test was saved", async () => {
  mocks.read.mockRejectedValue(Object.assign(Error(), { code: "ENOENT" }));
  expect(await (await GET(request())).json()).toEqual({ review: null });
});
it("serves prepared images only after authorization and manifest membership", async () => {
  mocks.read
    .mockResolvedValueOnce(
      JSON.stringify({
        documentId: id,
        versionId: id,
        model: "jev-1.14.0",
        rows: [],
        preparedPages: [2],
      }),
    )
    .mockResolvedValueOnce(Buffer.from([137, 80, 78, 71]));
  const response = await GET(new Request(request().url + "&page=2"));
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("does not read arbitrary page paths or unprepared pages", async () => {
  expect((await GET(new Request(request().url + "&page=2"))).status).toBe(404);
  expect(mocks.read).toHaveBeenCalledTimes(1);
});

afterEach(() => vi.unstubAllEnvs());
it("blocks test reviews when Dev is disabled before reading private data", async () => {
  vi.stubEnv("FOREMANHQ_DEV_FEATURES", "false");
  expect((await GET(request())).status).toBe(404);
  expect(mocks.access).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});
