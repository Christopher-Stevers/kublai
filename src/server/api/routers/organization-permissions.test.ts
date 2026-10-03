// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

// Use the real tRPC middleware, input schema, permission resolver and mutation.
// Only database IO and unrelated organization seeding are replaced.
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/utils/seed-organization", () => ({ seedOrganization: vi.fn() }));

import { organizationRouter } from "./organization";
import type { createTRPCContext } from "~/server/api/trpc";
import { PERMISSION_KEYS, type PermissionMap } from "~/lib/permission-catalog";
import { resolvePermissions, toStoredConfig } from "~/server/auth/permissions";
import { users } from "~/server/db/schema";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "actor";
const targetId = "target";
const paid = { stripeSubscriptionId: "sub_test", subscriptionStatus: "active" };
const executive = {
  id: targetId,
  organizationId,
  organizationAccessStatus: "approved",
  role: "user",
  permissionConfig: null,
  ...paid,
};
const standard = {
  id: targetId,
  organizationId,
  organizationAccessStatus: "approved",
  role: "user",
  permissionConfig: null,
};
const delegatedPermissions = toStoredConfig({
  "org.members": true,
  "tab.organization": true,
});
const allAllowed: PermissionMap = Object.fromEntries(
  PERMISSION_KEYS.map((key) => [key, true]),
) as PermissionMap;
type Row = Record<string, unknown>;

function setup(target: Row | null, actorPatch: Row = {}, authenticated = true) {
  const actor = {
    ...standard,
    id: actorId,
    permissionConfig: delegatedPermissions,
    ...actorPatch,
  };
  const predicates: SQL[] = [];
  const writePredicates: SQL[] = [];
  const events: string[] = [];
  const lock = vi.fn((mode: string) => {
    events.push(`lock:${mode}`);
    return query;
  });
  const query = Object.assign(Promise.resolve(target ? [target] : []), {
    from: vi.fn((_table: unknown) => query),
    where: vi.fn((predicate: SQL) => {
      predicates.push(predicate);
      return query;
    }),
    limit: vi.fn((_count: number) => query),
    for: lock,
  });
  const select = vi.fn(() => {
    events.push("select");
    return query;
  });
  const writes: Row[] = [];
  const update = vi.fn((_table: unknown) => ({
    set: vi.fn((data: Row) => {
      events.push("write");
      writes.push(data);
      return {
        where: vi.fn((predicate: SQL) => {
          writePredicates.push(predicate);
          return {
            returning: vi.fn(async () => [{ ...target, ...data }]),
          };
        }),
      };
    }),
  }));
  const tx = { select, update };
  const db = {
    ...tx,
    transaction: vi.fn(async (run: (value: typeof tx) => unknown) => run(tx)),
  };
  const context = {
    db,
    userId: authenticated ? actorId : null,
    user: authenticated ? actor : null,
    headers: new Headers(),
  } as unknown as Awaited<ReturnType<typeof createTRPCContext>>;
  return {
    caller: organizationRouter.createCaller(context),
    db,
    tx,
    lock,
    writes,
    events,
    predicates,
    writePredicates,
  };
}

function input(userId = targetId, permissions: Partial<PermissionMap> = {}) {
  return { userId, accessStatus: "approved" as const, permissions };
}

function expectNoWrites(test: ReturnType<typeof setup>) {
  expect(test.tx.update).not.toHaveBeenCalled();
  expect(test.writes).toEqual([]);
}

function expectTenantPredicate(predicate: SQL | undefined, userId = targetId) {
  expect(predicate).toBeDefined();
  const sql = new PgDialect().sqlToQuery(predicate!);
  expect(sql.params).toContain(organizationId);
  expect(sql.params).toContain(userId);
  expect(sql.sql).toContain('"organizationId"');
}

describe("organization permission protection", () => {
  it.each([
    ["unauthenticated", {}, false, "UNAUTHORIZED"],
    ["missing permission", { permissionConfig: null }, true, "FORBIDDEN"],
    ["pending paid member", { ...paid, organizationAccessStatus: "pending" }, true, "FORBIDDEN"],
    ["denied paid member", { ...paid, organizationAccessStatus: "denied" }, true, "FORBIDDEN"],
    ["missing organization", { ...paid, organizationId: null }, true, "FORBIDDEN"],
  ])("rejects %s before reading members", async (_label, actor, authenticated, code) => {
    const test = setup(executive, actor, authenticated);
    await expect(test.caller.updateOrganizationMember(input())).rejects.toMatchObject({ code });
    expect(test.db.transaction).not.toHaveBeenCalled();
    expect(test.tx.select).not.toHaveBeenCalled();
    expectNoWrites(test);
  });

  it("scopes the locked target lookup to this organization and rejects a missing/foreign member", async () => {
    const test = setup(null);
    await expect(test.caller.updateOrganizationMember(input())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expectTenantPredicate(test.predicates[0]);
    expect(test.lock).toHaveBeenCalledWith("update");
    expectNoWrites(test);
  });

  it.each([
    ["Executive", executive],
    ["admin", { ...standard, role: "admin" }],
  ])("rejects disabling any %s permission through a direct API request", async (_label, target) => {
    for (const key of PERMISSION_KEYS) {
      const test = setup(target);
      await expect(
        test.caller.updateOrganizationMember(input(targetId, { [key]: false })),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(test.lock).toHaveBeenCalledWith("update");
      expectTenantPredicate(test.predicates[0]);
      expectNoWrites(test);
    }
  });

  it.each([
    ["Executive", executive],
    ["admin", { ...standard, role: "admin" }],
    ["legacy approved Executive", { ...executive, organizationAccessStatus: null }],
  ])("cannot revoke approved %s membership", async (_label, target) => {
    for (const accessStatus of ["pending", "denied"] as const) {
      const test = setup(target);
      await expect(
        test.caller.updateOrganizationMember({ ...input(), accessStatus }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expectNoWrites(test);
    }
  });

  it.each(["pending", "denied"])("can explicitly restore a %s Executive without persisting derived permissions", async (status) => {
    const stored = toStoredConfig({ "quotes.create": true, "tab.organization": false });
    const test = setup({ ...executive, organizationAccessStatus: status, permissionConfig: stored });
    await test.caller.updateOrganizationMember(input(targetId, allAllowed));
    expect(test.lock).toHaveBeenCalledWith("update");
    expect(test.writes).toHaveLength(1);
    expect(test.writes[0]?.organizationAccessStatus).toBe("approved");
    const config = test.writes[0]?.permissionConfig ?? stored;
    expect(config).toEqual(stored);
    expect(config).not.toEqual(toStoredConfig(allAllowed));
    expectTenantPredicate(test.writePredicates[0]);
    expect(test.events.indexOf("lock:update")).toBeLessThan(test.events.indexOf("write"));
  });

  it("preserves Executive config when a current client submits a full checked map", async () => {
    const stored = toStoredConfig({ "quotes.create": true });
    const test = setup({ ...executive, permissionConfig: stored });
    await test.caller.updateOrganizationMember(input(targetId, allAllowed));
    expect(test.writes).toHaveLength(1);
    expect(test.writes[0]?.permissionConfig ?? stored).toEqual(stored);
    expect(test.tx.update).toHaveBeenCalledWith(users);
    expectTenantPredicate(test.predicates[0]);
    expectTenantPredicate(test.writePredicates[0]);
    const afterExpiration = resolvePermissions({
      ...executive,
      subscriptionStatus: "canceled",
      permissionConfig: test.writes[0]?.permissionConfig ?? stored,
    });
    expect(afterExpiration["org.members"]).toBe(false);
    expect(afterExpiration["quotes.create"]).toBe(true);
  });

  it.each([
    ["empty replacement", {}],
    ["missing Organization tab", { "org.members": true }],
    ["missing member management", { "tab.organization": true }],
    ["explicit management denial", { "org.members": false, "tab.organization": true }],
  ])("prevents self lockout from a standard manager's %s", async (_label, permissions) => {
    const test = setup({ ...standard, id: actorId, permissionConfig: delegatedPermissions });
    await expect(
      test.caller.updateOrganizationMember(input(actorId, permissions)),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expectNoWrites(test);
  });

  it.each(["pending", "denied"] as const)("cannot change one's own membership to %s", async (accessStatus) => {
    const test = setup({ ...standard, id: actorId, permissionConfig: delegatedPermissions });
    await expect(
      test.caller.updateOrganizationMember({
        ...input(actorId, delegatedPermissions.permissions),
        accessStatus,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expectNoWrites(test);
  });

  it("allows standard managers to edit themselves while retaining effective management access", async () => {
    const test = setup({ ...standard, id: actorId, permissionConfig: delegatedPermissions });
    const permissions = { ...delegatedPermissions.permissions, "orders.send": true, "parts.edit": false };
    await test.caller.updateOrganizationMember(input(actorId, permissions));
    expect(test.writes[0]?.permissionConfig).toEqual(toStoredConfig(permissions));
    expectTenantPredicate(test.writePredicates[0], actorId);
  });

  it.each([
    ["ordinary", standard],
    ["expired", { ...executive, subscriptionEndsAt: new Date("2000-01-01") }],
    ["worker", { ...executive, role: "worker" }],
    ["one-time", { ...standard, hasOneTimeAccess: true }],
  ])("keeps another %s standard account's permission and membership controls editable", async (_label, target) => {
    const test = setup(target);
    const permissions = { "parts.edit": false, "quotes.create": true };
    await test.caller.updateOrganizationMember({ ...input(targetId, permissions), accessStatus: "denied" });
    expect(test.writes[0]?.permissionConfig).toEqual(toStoredConfig(permissions));
    expect(test.writes[0]?.organizationAccessStatus).toBe("denied");
    expectTenantPredicate(test.predicates[0]);
    expectTenantPredicate(test.writePredicates[0]);
  });
});
