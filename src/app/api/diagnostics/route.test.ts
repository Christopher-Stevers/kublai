// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  execute: vi.fn(async () => []),
  can: vi.fn(),
}));
vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: mocks.identity,
}));
vi.mock("~/server/auth/permissions", () => ({ userCan: mocks.can }));
vi.mock("~/server/db", () => ({
  db: {
    execute: mocks.execute,
    transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ execute: mocks.execute }),
  },
}));
import { POST, GET } from "./route";
const payload = {
  kind: "action_failed",
  feature: "rooms",
  device: "touch",
  release: "838ef32",
  code: "server",
  duration: "under_10s",
};
const request = (body: unknown, origin = "https://example.test") =>
  new Request("https://example.test/api/diagnostics", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({
    user: {
      id: crypto.randomUUID(),
      organizationId: "00000000-0000-4000-8000-000000000001",
      organizationAccessStatus: "approved",
    },
  });
  mocks.can.mockReturnValue(true);
});
it("requires same origin and membership", async () => {
  expect((await POST(request(payload, "https://bad.test"))).status).toBe(400);
  mocks.identity.mockResolvedValue({ user: null });
  expect((await POST(request(payload))).status).toBe(401);
  expect(mocks.execute).not.toHaveBeenCalled();
});
it("rejects free-text additions before persistence", async () => {
  expect(
    (await POST(request({ ...payload, message: "sensitive content" }))).status,
  ).toBe(400);
  expect(mocks.execute).not.toHaveBeenCalled();
});
it("aggregates valid events and requires company permission to read", async () => {
  expect((await POST(request(payload))).status).toBe(200);
  expect(mocks.execute).toHaveBeenCalledTimes(2);
  mocks.can.mockReturnValue(false);
  expect(
    (await GET(new Request("https://example.test/api/diagnostics"))).status,
  ).toBe(403);
});
it("does not collect employee simulations", async () => {
  mocks.identity.mockResolvedValue({
    user: {
      id: "sim",
      organizationId: "org",
      organizationAccessStatus: "approved",
    },
    simulation: { id: "sim" },
  });
  expect((await POST(request(payload))).status).toBe(200);
  expect(mocks.execute).not.toHaveBeenCalled();
});
