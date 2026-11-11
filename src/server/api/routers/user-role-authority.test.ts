// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
import { userRouter } from "./user";
import { liveAccountScope } from "~/lib/live-protocol";
import type { createTRPCContext } from "~/server/api/trpc";
const org = "11111111-1111-4111-8111-111111111111";
const database = { select: vi.fn(), execute: vi.fn() };
const base = {
  id: "row-user",
  organizationId: org,
  organizationAccessStatus: "approved",
  role: "user",
  hasOneTimeAccess: false,
  stripeSubscriptionId: null as string | null,
  subscriptionStatus: null as string | null,
  subscriptionEndsAt: null as Date | null,
};
function read(
  user: Partial<typeof base> & { permissionConfig?: unknown } = {},
  simulation: { id: string } | null = null,
  actorId = base.id,
) {
  return userRouter
    .createCaller({
      db: database,
      userId: "effective-user",
      user: { ...base, ...user },
      simulation,
      actorUser: { id: actorId },
      headers: new Headers(),
    } as unknown as Awaited<ReturnType<typeof createTRPCContext>>)
    .getMyRole();
}
beforeEach(() => vi.clearAllMocks());
it("returns exact effective-user scope, appAccess and executive entitlement with no new DB query", async () => {
  const result = await read({ role: "admin" });
  expect(result).toMatchObject({
    accountScope: liveAccountScope(org, "effective-user"),
    appAccess: true,
    canEditExecutive: true,
    role: "admin",
    organizationId: org,
  });
  expect(result.permissions).toHaveProperty("can");
  expect(database.select).not.toHaveBeenCalled();
  expect(database.execute).not.toHaveBeenCalled();
});
it("full simulation scope never grants executive sorting", async () => {
  expect(await read({ role: "admin" }, { id: "simulation-one" })).toMatchObject(
    {
      accountScope: liveAccountScope(org, "effective-user", "simulation-one"),
      appAccess: true,
      canEditExecutive: false,
    },
  );
});
for (const status of ["pending", "blocked"])
  it(`org ${status} cannot edit despite managing seat`, async () => {
    expect(
      await read({ role: "admin", organizationAccessStatus: status }),
    ).toMatchObject({ appAccess: false, canEditExecutive: false });
  });
it("missing organization denies app access while preserving protected role query", async () => {
  expect(await read({ role: "admin", organizationId: "" })).toMatchObject({
    accountScope: null,
    appAccess: false,
    canEditExecutive: false,
  });
});
it("matches legacy null/empty organization status app access", async () => {
  expect(await read({ organizationAccessStatus: "" })).toMatchObject({
    appAccess: true,
    canEditExecutive: false,
  });
});
it("wall-clock subscription expiry changes capability without a preference write", async () => {
  const active = {
    stripeSubscriptionId: "sub-test",
    subscriptionStatus: "active",
    subscriptionEndsAt: new Date(Date.now() + 60000),
  };
  expect(await read(active)).toMatchObject({ canEditExecutive: true });
  expect(
    await read({ ...active, subscriptionEndsAt: new Date(Date.now() - 1) }),
  ).toMatchObject({ appAccess: true, canEditExecutive: false });
});
it("worker cannot gain managing seat from subscription", async () => {
  expect(
    await read({
      role: "worker",
      stripeSubscriptionId: "sub-test",
      subscriptionStatus: "active",
    }),
  ).toMatchObject({ appAccess: true, canEditExecutive: false });
});

it("returns the exact notification account independently of legacy app access", async () => {
  expect(await read({ organizationAccessStatus: "" })).toMatchObject({
    appAccess: true,
    notificationIdentity: {
      accountKey: null,
      userId: "row-user",
      organizationId: org,
      actorId: "row-user",
      simulationId: null,
    },
  });
  expect(await read()).toMatchObject({
    notificationIdentity: { accountKey: `row-user:${org}` },
  });
  expect(await read({}, { id: "simulation-one" })).toMatchObject({
    notificationIdentity: { simulationId: "simulation-one" },
  });
});

it("uses physical actor separately and applies the notification dashboard permission check", async () => {
  expect(await read({}, { id: "sim" }, "physical-actor")).toMatchObject({
    notificationIdentity: {
      actorId: "physical-actor",
      userId: "row-user",
      simulationId: "sim",
    },
  });
  expect(
    await read({
      permissionConfig: { version: 2, permissions: { "tab.dashboard": false } },
    }),
  ).toMatchObject({
    appAccess: true,
    notificationIdentity: { accountKey: null },
  });
});
