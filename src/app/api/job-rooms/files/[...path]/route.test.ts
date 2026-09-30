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
  readFile: vi.fn(),
  records: [] as { id: string; organizationId: string }[],
  query: { sql: "", params: [] as unknown[] },
}));
vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: mocks.identity,
}));
vi.mock("~/server/db", () => ({ db: { execute: mocks.execute } }));
vi.mock("~/server/rooms/storage", () => ({
  readJobRoomFile: mocks.readFile,
}));

import { GET } from "./route";

const ownJob = "0391aed4-7773-47ec-9141-09df373ec008";
const foreignJob = "84e2cf46-79c4-4780-998b-9c104ef42f07";
const upload = "b06815cb-ebac-42e0-8521-db654e9cad60";
const request = () => new Request("http://local/api/job-rooms/files/fixture");
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
  mocks.readFile.mockResolvedValue(Buffer.from("private drawing"));
});

test("an organization member can read its PDF with private cache headers", async () => {
  const req = request();
  const response = await GET(req, context(ownJob, upload, "plan.pdf"));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("private drawing");
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
  expect(mocks.identity).toHaveBeenCalledWith(req.headers, { allowDev: true });
  expect(mocks.query.sql).toContain('"organizationId"');
  expect(mocks.query.params).toEqual([ownJob, "org-a"]);
  expect(mocks.readFile).toHaveBeenCalledWith(`${ownJob}/${upload}/plan.pdf`);
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
    expect(mocks.readFile).not.toHaveBeenCalled();
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
  expect(mocks.readFile).not.toHaveBeenCalled();
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
    expect(mocks.readFile).not.toHaveBeenCalled();
  },
);

test("a missing authorized file returns a generic 404", async () => {
  mocks.readFile.mockRejectedValue(new Error("private storage location"));
  const response = await GET(request(), context(ownJob, "plan.pdf"));
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Not found" });
});
