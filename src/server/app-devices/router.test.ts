// @vitest-environment node
import { vi, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: vi.fn(),
}));
vi.mock("~/server/simulation/service", () => ({
  recordSimulationAction: vi.fn(async () => "audit"),
  finishSimulationAction: vi.fn(async () => undefined),
}));
vi.mock("./service", () => ({
  recordAppDevice: vi.fn(async () => undefined),
  organizationAppDevices: vi.fn(async () => []),
}));
import { appDevicesRouter } from "~/server/api/routers/appDevices";
import { recordAppDevice, organizationAppDevices } from "./service";
const org = randomUUID();
const db = {};
const user = {
  id: "actual-user",
  organizationId: org,
  organizationAccessStatus: "approved",
  role: "admin",
};
function caller(overrides: Record<string, unknown> = {}) {
  return appDevicesRouter.createCaller({
    db,
    userId: user.id,
    user,
    headers: new Headers(),
    actorUser: null,
    simulation: null,
    ...overrides,
  } as unknown as Parameters<typeof appDevicesRouter.createCaller>[0]);
}
const report = {
  deviceId: randomUUID(),
  deviceType: "phone" as const,
  platform: "Android" as const,
  mode: "browser" as const,
  installButtonVisible: true,
};
beforeEach(() => vi.clearAllMocks());
it("binds reports to the authenticated user, not a supplied employee", async () => {
  await caller().report(report);
  expect(recordAppDevice).toHaveBeenCalledWith(db, user.id, report);
  await expect(
    caller().report({ ...report, userId: "victim" } as typeof report),
  ).rejects.toThrow();
  expect(recordAppDevice).toHaveBeenCalledTimes(1);
});
it("does not record simulations or unapproved sessions", async () => {
  expect(
    await caller({ simulation: { employeeId: "other" } }).report(report),
  ).toEqual({ recorded: false });
  await expect(
    caller({ user: { ...user, organizationAccessStatus: "pending" } }).report(
      report,
    ),
  ).rejects.toThrow();
  expect(recordAppDevice).not.toHaveBeenCalled();
});
it("requires member-management access and scopes queries to current organization", async () => {
  await caller().organization({ organizationId: org });
  expect(organizationAppDevices).toHaveBeenCalledWith(db, org);
  await expect(
    caller().organization({ organizationId: randomUUID() }),
  ).rejects.toThrow();
  await expect(
    caller({
      user: {
        ...user,
        role: "user",
        permissionConfig: {
          version: 2,
          permissions: { "tab.organization": true, "org.members": false },
        },
      },
    }).organization({ organizationId: org }),
  ).rejects.toThrow();
  expect(organizationAppDevices).toHaveBeenCalledTimes(1);
});
