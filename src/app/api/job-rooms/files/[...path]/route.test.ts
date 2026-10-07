// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  user: { id: "owner", organizationId: "org-a" } as {
    id: string;
    organizationId: string | null;
  } | null,
  identity: vi.fn(),
  execute: vi.fn(),
  openFile: vi.fn(),
  stream: vi.fn(),
  close: vi.fn(),
  records: [] as { id: string; organizationId: string }[],
  query: { sql: "", params: [] as unknown[] },
}));
vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: mocks.identity,
}));
vi.mock("~/server/db", () => ({ db: { execute: mocks.execute } }));
vi.mock("~/server/rooms/storage", () => ({
  openJobRoomFile: mocks.openFile,
}));

import { GET, HEAD } from "./route";

const ownJob = "0391aed4-7773-47ec-9141-09df373ec008";
const foreignJob = "84e2cf46-79c4-4780-998b-9c104ef42f07";
const upload = "b06815cb-ebac-42e0-8521-db654e9cad60";
const request = (headers?: HeadersInit) =>
  new Request("http://local/api/job-rooms/files/fixture", { headers });
const bytes = Buffer.from("private drawing");
const modified = new Date("2026-10-07T12:00:00.000Z");
const etag = '"fixture-v1"';
const context = (...path: string[]) => ({ params: Promise.resolve({ path }) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user = { id: "owner", organizationId: "org-a" };
  mocks.identity.mockImplementation(async () => ({
    userId: mocks.user?.id ?? null,
    user: mocks.user,
  }));
  mocks.records = [
    { id: ownJob, organizationId: "org-a" },
    { id: foreignJob, organizationId: "org-b" },
  ];
  mocks.query = { sql: "", params: [] };
  mocks.execute.mockImplementation(async (condition: SQL) => {
    mocks.query = new PgDialect().sqlToQuery(condition);
    return mocks.records.filter(
      (row) =>
        mocks.query.params.includes(row.id) &&
        mocks.query.params.includes(row.organizationId),
    );
  });
  mocks.close.mockResolvedValue(undefined);
  mocks.stream.mockImplementation(
    (start?: number, end?: number) =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            bytes.subarray(start ?? 0, (end ?? bytes.length - 1) + 1),
          );
          controller.close();
        },
      }),
  );
  mocks.openFile.mockImplementation(async () => ({
    size: bytes.length,
    modified,
    etag,
    stream: mocks.stream,
    close: mocks.close,
  }));
});

test("an organization member can read its PDF with private cache headers", async () => {
  const req = request();
  const response = await GET(req, context(ownJob, upload, "plan.pdf"));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("private drawing");
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("cache-control")).toBe(
    "private, max-age=3600, immutable, no-transform",
  );
  expect(mocks.identity).toHaveBeenCalledWith(req.headers, { allowDev: true });
  expect(mocks.query.sql).toContain('"organizationId"');
  expect(mocks.query.params).toEqual([ownJob, "org-a"]);
  expect(mocks.openFile).toHaveBeenCalledWith(`${ownJob}/${upload}/plan.pdf`);
});

test("authorized legacy preview paths preserve their content type", async () => {
  const response = await GET(request(), context(ownJob, "floor-12.webp"));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/webp");
});

test.each([null, { id: "owner", organizationId: null }])(
  "unauthenticated or organization-less requests cannot read files: %j",
  async (user) => {
    mocks.user = user;
    const response = await GET(request(), context(ownJob, "plan.pdf"));
    expect(response.status).toBe(401);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.openFile).not.toHaveBeenCalled();
  },
);

test("foreign and missing jobs return the same response before touching storage", async () => {
  const foreign = await GET(request(), context(foreignJob, upload, "plan.pdf"));
  const missing = await GET(
    request(),
    context("70bd721b-622d-426e-8c1e-d41799b63e24", "plan.pdf"),
  );
  expect(foreign.status).toBe(404);
  expect(missing.status).toBe(404);
  expect(await foreign.json()).toEqual(await missing.json());
  expect(mocks.openFile).not.toHaveBeenCalled();
});

test.each(
  [
    [],
    [ownJob, "..", "plan.pdf"],
    [ownJob, "plan.pdf", "extra"],
    [ownJob, "floor--1.webp"],
    [ownJob, "floor-1.png"],
    ["------------------------------------", "plan.pdf"],
  ].map((path) => ({ path })),
)(
  "invalid storage paths are rejected before any database or disk read: %j",
  async ({ path }) => {
    const response = await GET(request(), context(...path));
    expect(response.status).toBe(404);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.openFile).not.toHaveBeenCalled();
  },
);

test("a missing authorized file returns a generic 404", async () => {
  mocks.openFile.mockRejectedValue(new Error("private storage location"));
  const response = await GET(request(), context(ownJob, "plan.pdf"));
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Not found" });
});

test.each([
  ["bytes=0-6", "private", "bytes 0-6/15"],
  ["bytes=8-", "drawing", "bytes 8-14/15"],
  ["bytes=-7", "drawing", "bytes 8-14/15"],
  ["bytes=8-999999", "drawing", "bytes 8-14/15"],
])(
  "serves only the requested PDF range %s",
  async (range, body, contentRange) => {
    const response = await GET(
      request({ range }),
      context(ownJob, upload, "plan.pdf"),
    );
    expect(response.status).toBe(206);
    expect(await response.text()).toBe(body);
    expect(response.headers.get("content-range")).toBe(contentRange);
    expect(response.headers.get("content-length")).toBe(String(body.length));
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("etag")).toBe(etag);
    expect(response.headers.get("last-modified")).toBe(modified.toUTCString());
  },
);

test.each([
  "bytes=15-",
  "bytes=10-9",
  "bytes=-0",
  "bytes=999999999999999999999-",
])(
  "returns416 without reading bytes for unsatisfiable range %s",
  async (range) => {
    const response = await GET(
      request({ range }),
      context(ownJob, upload, "plan.pdf"),
    );
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */15");
    expect(await response.text()).toBe("");
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  },
);

test.each(["items=0-1", "bytes=0-1,4-5", "bytes=-", "bytes=bad"])(
  "ignores unsupported/malformed range %s and serves the whole representation",
  async (range) => {
    const response = await GET(
      request({ range }),
      context(ownJob, upload, "plan.pdf"),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("private drawing");
    expect(response.headers.get("content-range")).toBeNull();
  },
);

test.each([etag, `W/${etag}`, `"other", W/${etag}`, "*"])(
  "revalidates matching If-None-Match %s without reading data",
  async (tag) => {
    const response = await GET(
      request({ "if-none-match": tag, range: "bytes=0-1" }),
      context(ownJob, upload, "plan.pdf"),
    );
    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledOnce();
  },
);

test("uses dates only when If-None-Match was not supplied", async () => {
  const cached = await GET(
    request({ "if-modified-since": modified.toUTCString() }),
    context(ownJob, "floor-1.webp"),
  );
  expect(cached.status).toBe(304);
  const changed = await GET(
    request({
      "if-none-match": '"old"',
      "if-modified-since": modified.toUTCString(),
    }),
    context(ownJob, "floor-1.webp"),
  );
  expect(changed.status).toBe(200);
  expect(changed.headers.get("cache-control")).toBe(
    "private, max-age=3600, no-transform",
  );
  expect(await changed.text()).toBe("private drawing");
});

test.each([etag, modified.toUTCString()])(
  "honors If-Range when the file matches %s",
  async (condition) => {
    const response = await GET(
      request({ range: "bytes=0-6", "if-range": condition }),
      context(ownJob, upload, "plan.pdf"),
    );
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("private");
  },
);

test.each(['"old"', `W/${etag}`, "Wed, 01 Oct 2025 12:00:00 GMT"])(
  "returns a fresh complete representation for stale If-Range %s",
  async (condition) => {
    const response = await GET(
      request({ range: "bytes=0-6", "if-range": condition }),
      context(ownJob, upload, "plan.pdf"),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("private drawing");
  },
);

test("HEAD includes metadata and ignores ranges without streaming any bytes", async () => {
  const response = await HEAD(
    request({ range: "bytes=0-6" }),
    context(ownJob, upload, "plan.pdf"),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-length")).toBe("15");
  expect(response.headers.get("etag")).toBe(etag);
  expect(await response.text()).toBe("");
  expect(mocks.stream).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledOnce();
});

test.each([
  new Headers({ "if-none-match": etag }),
  new Headers({ range: "bytes=999-" }),
])(
  "checks tenant ownership before revealing file metadata for %j",
  async (headers) => {
    const response = await GET(
      request(headers),
      context(foreignJob, upload, "plan.pdf"),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("content-range")).toBeNull();
    expect(mocks.openFile).not.toHaveBeenCalled();
  },
);

test("serves tiles and manifests through the same private tenant boundary", async () => {
  for (const [tail, type] of [
    [["tiles", "1", "2", "0_1.webp"], "image/webp"],
    [["tiles", "1", "manifest.json"], "application/json"],
  ] as const) {
    const response = await GET(request(), context(ownJob, upload, ...tail));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(type);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("content-length")).toBe("15");
    await response.arrayBuffer();
  }
});

test("HEAD does not reveal foreign file metadata", async () => {
  const response = await HEAD(
    request({ "if-none-match": etag }),
    context(foreignJob, upload, "plan.pdf"),
  );
  expect(response.status).toBe(404);
  expect(response.headers.get("etag")).toBeNull();
  expect(response.headers.get("last-modified")).toBeNull();
  expect(mocks.openFile).not.toHaveBeenCalled();
});
