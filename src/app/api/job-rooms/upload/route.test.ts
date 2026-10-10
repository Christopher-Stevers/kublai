// @vitest-environment node
import { beforeAll, afterAll, beforeEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
const mocks = vi.hoisted(() => ({
  user: { id: "owner", organizationId: "org" } as {
    id: string;
    organizationId: string;
  } | null,
  managing: true,
  grants: null as Record<string, boolean> | null,
  rows: [] as unknown[],
  spawn: vi.fn(),
  select: vi.fn(),
}));
vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: async () => ({ userId: mocks.user?.id ?? null, user: mocks.user }),
}));
vi.mock("~/server/auth/permissions", () => ({
  userCan: (_user: unknown, key: string) => mocks.grants?.[key] ?? mocks.managing,
}));
vi.mock("~/server/db", () => ({ db: { select: mocks.select } }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
import { POST, GET } from "./route";
import {
  readSession,
  releaseWorker,
  saveSession,
} from "../../../../server/rooms/upload-session";
const jobId = "0391aed4-7773-47ec-9141-09df373ec008";
let cwd: string;
let temp: string;
test("delete permission does not grant drawing uploads", async () => {
  mocks.grants = { "tab.dashboard": true, "drawings.view": true, "drawings.upload": false, "drawings.delete": true };
  const response = await POST(new Request("http://local/api/job-rooms/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId, filename: "drawing.pdf", size: 100 }) }));
  expect(response.status).toBe(403);
  expect(mocks.select).not.toHaveBeenCalled();
  expect(mocks.spawn).not.toHaveBeenCalled();
});

beforeAll(async () => {
  cwd = process.cwd();
  temp = await mkdtemp(path.join(os.tmpdir(), "upload-route-test-"));
  process.chdir(temp);
});
afterAll(async () => {
  process.chdir(cwd);
  await rm(temp, { recursive: true, force: true });
});
beforeEach(async () => {
  await rm(
    path.join(
      process.cwd(),
      "uploads/job-floor-plans/.upload-sessions/worker.lock",
    ),
    { force: true },
  );
  vi.clearAllMocks();
  mocks.user = { id: "owner", organizationId: "org" };
  mocks.managing = true;
  mocks.grants = null;
  mocks.rows = [];
  mocks.select.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: async () => [{ id: jobId }],
        then: (resolve: (rows: unknown[]) => unknown) =>
          Promise.resolve(mocks.rows).then(resolve),
      }),
    }),
  }));
  mocks.spawn.mockImplementation(() => {
    const e = new EventEmitter() as EventEmitter & { unref: () => void };
    e.unref = () => undefined;
    queueMicrotask(() => e.emit("spawn"));
    return e;
  });
});
const init = () =>
  new Request("http://local/api/job-rooms/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId, filename: "a.pdf", size: 7 }),
  });
test("authentication and permission failures return JSON before body parsing", async () => {
  mocks.user = null;
  expect((await POST(init())).status).toBe(401);
  mocks.user = { id: "owner", organizationId: "org" };
  mocks.managing = false;
  expect((await POST(init())).status).toBe(403);
});
test("old multipart client receives actionable JSON rather than formData truncation", async () => {
  const response = await POST(
    new Request("http://local/api/job-rooms/upload", {
      method: "POST",
      body: new FormData(),
    }),
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error).toMatch(/Reload/);
});
test("init/chunk/finish/poll is bounded, asynchronous, owner-scoped and recovers commit-before-response", async () => {
  const started = await POST(init());
  expect(started.status).toBe(200);
  const { uploadId } = await started.json();
  const url = `http://local/api/job-rooms/upload?uploadId=${uploadId}`;
  const incomplete = await POST(
    new Request(`${url}&action=finish`, { method: "POST" }),
  );
  expect(incomplete.status).toBe(409);
  const chunk = await POST(
    new Request(`${url}&offset=0`, { method: "POST", body: "%PDF-12" }),
  );
  expect(chunk.status).toBe(200);
  const finish = await POST(
    new Request(`${url}&action=finish`, { method: "POST" }),
  );
  expect(finish.status).toBe(202);
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
  expect(mocks.spawn.mock.calls[0]?.[0]).toMatch(
    /scripts\/run-upload-worker\.sh$/,
  );
  expect(mocks.spawn.mock.calls[0]?.[1]).toEqual([uploadId, "600"]);
  expect(mocks.spawn.mock.calls[0]?.[2]).toMatchObject({
    detached: true,
    stdio: "ignore",
  });
  await POST(new Request(`${url}&action=finish`, { method: "POST" }));
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
  expect((await readSession(uploadId)).status).toBe("processing");
  mocks.user = { id: "stranger", organizationId: "org" };
  expect((await GET(new Request(url))).status).toBe(404);
  mocks.user = { id: "owner", organizationId: "org" };
  mocks.rows = [
    {
      id: "new-sheet",
      name: "A501",
      imageUrl: `/api/job-rooms/files/${jobId}/${uploadId}/floor-1.webp`,
      pageNumber: 2,
    },
  ];
  const response = await GET(new Request(url));
  const body = await response.json();
  expect(body.status).toBe("ready");
  expect(body.floors).toHaveLength(1);
  // There is intentionally no DB insert/update/delete API in this route mock:
  // the request process only admits chunks and launches the isolated worker.
});

test("an explicit retry reprocesses a retained failed upload but finish alone does not", async () => {
  const started = await POST(init());
  const { uploadId } = await started.json();
  const url = `http://local/api/job-rooms/upload?uploadId=${uploadId}`;
  await POST(
    new Request(`${url}&offset=0`, { method: "POST", body: "%PDF-12" }),
  );
  const failed = await readSession(uploadId);
  await saveSession({ ...failed, status: "error", error: "old limit" });

  const finish = await POST(
    new Request(`${url}&action=finish`, { method: "POST" }),
  );
  expect((await finish.json()).status).toBe("error");
  expect(mocks.spawn).not.toHaveBeenCalled();

  const retry = await POST(
    new Request(`${url}&action=retry`, { method: "POST" }),
  );
  expect(retry.status).toBe(202);
  expect((await retry.json()).status).toBe("processing");
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
  const processing = await readSession(uploadId);
  expect(processing.status).toBe("processing");
  expect(processing.error).toBeUndefined();
  await releaseWorker(uploadId);
});
const setId = "5c2c9f0e-8f6b-4a8a-9b55-0d3f1c7a2b11";
const drawingInit = (body: Record<string, unknown>) =>
  new Request("http://local/api/job-rooms/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId, filename: "mech.pdf", size: 7, ...body }),
  });
test("Drawings uploads remember their folder, reject a missing or invalid folder, and report sheets", async () => {
  expect((await POST(drawingInit({ drawingSetId: "not-a-uuid" }))).status).toBe(400);
  // Job found, folder not found in this job/organization.
  mocks.select
    .mockImplementationOnce(() => ({ from: () => ({ where: () => ({ limit: async () => [{ id: jobId }] }) }) }))
    .mockImplementationOnce(() => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }));
  const missing = await POST(drawingInit({ drawingSetId: setId }));
  expect(missing.status).toBe(404);
  expect((await missing.json()).error).toMatch(/folder/i);

  const started = await POST(drawingInit({ drawingSetId: setId, extra: "ignored" }));
  expect(started.status).toBe(200);
  const { uploadId } = await started.json();
  const session = await readSession(uploadId);
  expect(session.drawingSetId).toBe(setId);
  // Unknown JSON keys are not copied into the session.
  expect(Object.keys(session)).not.toContain("extra");

  const url = `http://local/api/job-rooms/upload?uploadId=${uploadId}`;
  await POST(new Request(`${url}&offset=0`, { method: "POST", body: "%PDF-12" }));
  expect((await POST(new Request(`${url}&action=finish`, { method: "POST" }))).status).toBe(202);
  mocks.rows = [{ id: "sheet-1" }, { id: "sheet-2" }];
  const body = await (await GET(new Request(url))).json();
  expect(body).toMatchObject({ status: "ready", sheetCount: 2 });
  expect(body.floors).toBeUndefined();
  await releaseWorker(uploadId);
  await saveSession({ ...(await readSession(uploadId)), status: "ready" });
});
