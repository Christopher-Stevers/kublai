// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  access: vi.fn(),
  version: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  stream: vi.fn(),
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
vi.mock("~/server/documents/storage", () => ({ openDocumentBlob: mocks.open }));
import { GET, HEAD } from "./route";
const job = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const versionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const context = () => ({ params: Promise.resolve({ versionId }) });
const request = (headers: Record<string, string> = {}) =>
  new Request(
    `https://app.test/api/job-documents/files/${versionId}?jobId=${job}`,
    { headers },
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({ userId: "member" });
  mocks.access.mockResolvedValue({ job: { organizationId: "org" } });
  mocks.version.mockResolvedValue({
    version: {
      name: "drawing.pdf",
      mimeType: "application/pdf",
      sha256: "hash",
    },
  });
  mocks.stream.mockImplementation(
    (start?: number, end?: number) =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              "0123456789".slice(start ?? 0, (end ?? 9) + 1),
            ),
          );
          controller.close();
        },
      }),
  );
  mocks.open.mockResolvedValue({
    size: 10,
    etag: '"immutable"',
    modified: new Date("2026-10-01T00:00:00Z"),
    close: mocks.close,
    stream: mocks.stream,
  });
});
describe("private document byte serving", () => {
  it("streams requested ranges and suffixes without buffering the entire blob", async () => {
    const r = await GET(request({ range: "bytes=2-4" }), context());
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(r.headers.get("content-length")).toBe("3");
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect(r.headers.get("cache-control")).toContain("no-cache");
    expect(await r.text()).toBe("234");
    const suffix = await GET(request({ range: "bytes=-2" }), context());
    expect(await suffix.text()).toBe("89");
  });
  it("handles HEAD, conditional responses, invalid ranges and stale If-Range without leaking descriptors", async () => {
    expect(
      (await HEAD(request(), context())).headers.get("content-length"),
    ).toBe("10");
    expect(
      (await GET(request({ "if-none-match": '"immutable"' }), context()))
        .status,
    ).toBe(304);
    const invalid = await GET(request({ range: "bytes=100-" }), context());
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("content-range")).toBe("bytes */10");
    expect(mocks.close).toHaveBeenCalledTimes(3);
    expect(mocks.stream).not.toHaveBeenCalled();
    const full = await GET(
      request({ range: "bytes=2-4", "if-range": '"old"' }),
      context(),
    );
    expect(full.status).toBe(200);
    expect(await full.text()).toBe("0123456789");
  });
  it("rechecks document access before opening bytes or honoring cached metadata", async () => {
    mocks.access.mockRejectedValue(new TRPCError({ code: "FORBIDDEN" }));
    const r = await GET(
      request({ "if-none-match": '"immutable"', range: "bytes=0-1" }),
      context(),
    );
    expect(r.status).toBe(403);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });
});
