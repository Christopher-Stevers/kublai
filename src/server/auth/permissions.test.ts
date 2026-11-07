import { describe, expect, it } from "vitest";

import { PERMISSION_KEYS, PERMISSION_PRESETS } from "~/lib/permission-catalog";
import {
  getUserPermissions,
  hasManagingSeat,
  resolvePermissions,
  toStoredConfig,
} from "./permissions";

const paid = { stripeSubscriptionId: "sub_1", subscriptionStatus: "active" };
const allDenied = toStoredConfig(
  Object.fromEntries(PERMISSION_KEYS.map((key) => [key, false])),
);

describe("Systems permission defaults", () => {
  it("is off for every standard preset and existing member without an explicit grant", () => {
    expect(resolvePermissions({ role: "user" })["systems.access"]).toBe(false);
    for (const preset of PERMISSION_PRESETS) {
      expect(resolvePermissions({ role: "user", permissionConfig: toStoredConfig(preset.permissions) })["systems.access"]).toBe(false);
    }
    const oldManager = Object.fromEntries(PERMISSION_KEYS.filter(key => key !== "systems.access").map(key => [key, true]));
    expect(resolvePermissions({ role: "manager", permissionConfig: toStoredConfig(oldManager) })["systems.access"]).toBe(false);
  });
  it("retains Executive access and allows an explicit later grant", () => {
    expect(resolvePermissions({ ...paid, role: "user", permissionConfig: allDenied })["systems.access"]).toBe(true);
    expect(resolvePermissions({ role: "user", permissionConfig: toStoredConfig({ "systems.access": true }) })["systems.access"]).toBe(true);
  });
});

describe("resolvePermissions", () => {
  it("gives admins everything, whatever is stored", () => {
    const can = resolvePermissions({ role: " ADMIN ", permissionConfig: allDenied });
    expect(PERMISSION_KEYS.every((key) => can[key])).toBe(true);
  });

  it("keeps the old behaviour for standard accounts with no or legacy config", () => {
    const can = resolvePermissions({ role: "user" });
    expect(can["parts.create"]).toBe(true);
    expect(can["jobs.delete"]).toBe(false);
    expect(can["orders.send"]).toBe(false);
    expect(can["tab.draws"]).toBe(false);
    const legacy = resolvePermissions({
      role: "user",
      permissionConfig: {
        tabs: { catalogue: false },
        actions: { canEditParts: false, canDelete: true, canManageAssets: true },
      },
    });
    expect(legacy["tab.catalogue"]).toBe(false);
    expect(legacy["parts.edit"]).toBe(false);
    expect(legacy["parts.delete"]).toBe(true);
    expect(legacy["assets.manage"]).toBe(true);
  });

  it.each([
    ["version 2 denies", allDenied],
    ["legacy denies", { tabs: { organization: false }, actions: { canEditParts: false } }],
    ["empty configuration", {}],
    ["missing configuration", null],
    ["malformed configuration", { version: 2, permissions: [] }],
  ])("protects every Executive permission with %s", (_description, permissionConfig) => {
    const can = resolvePermissions({ ...paid, role: "user", permissionConfig });
    expect(PERMISSION_KEYS.every((key) => can[key])).toBe(true);
    expect(can["tab.organization"]).toBe(true);
    expect(can["org.members"]).toBe(true);
    expect(can["assets.manage"]).toBe(true);
  });

  it("continues applying version 2 grants and denials to standard accounts", () => {
    const field = resolvePermissions({
      role: "user",
      permissionConfig: toStoredConfig({
        "tab.draws": true,
        "draws.edit": true,
        "parts.edit": false,
      }),
    });
    expect(field["tab.draws"]).toBe(true);
    expect(field["draws.edit"]).toBe(true);
    expect(field["parts.edit"]).toBe(false);
    expect(field["orders.send"]).toBe(false);
  });

  it.each([
    ["worker with an active subscription", { ...paid, role: " WORKER " }],
    ["one-time purchase only", { role: "user", hasOneTimeAccess: true }],
    ["missing subscription ID", { role: "user", subscriptionStatus: "active" }],
    ["expired subscription", { ...paid, role: "user", subscriptionEndsAt: new Date("2000-01-01") }],
    ["invalid end date", { ...paid, role: "user", subscriptionEndsAt: "invalid" }],
    ["canceled subscription", { ...paid, role: "user", subscriptionStatus: "canceled" }],
    ["past-due subscription", { ...paid, role: "user", subscriptionStatus: "past_due" }],
    ["trial subscription", { ...paid, role: "user", subscriptionStatus: "trialing" }],
  ])("does not grant Executive access for %s", (_description, user) => {
    expect(hasManagingSeat(user)).toBe(false);
    const can = resolvePermissions({ ...user, permissionConfig: allDenied });
    expect(can["tab.organization"]).toBe(false);
    expect(can["org.members"]).toBe(false);
    expect(can["jobs.delete"]).toBe(false);
  });

  it("protects an active future-dated subscription without changing its stored config", () => {
    const user = {
      ...paid,
      role: "foreman",
      subscriptionEndsAt: "2100-01-01T00:00:00Z",
      permissionConfig: structuredClone(allDenied),
    };
    expect(hasManagingSeat(user)).toBe(true);
    expect(PERMISSION_KEYS.every((key) => resolvePermissions(user)[key])).toBe(true);
    expect(user.permissionConfig).toEqual(allDenied);
  });

  it("does not persist derived Executive permissions after a subscription expires", () => {
    const user = {
      ...paid,
      role: "user",
      permissionConfig: toStoredConfig({ "quotes.create": true }),
    };
    expect(resolvePermissions(user)["org.members"]).toBe(true);
    const expired = resolvePermissions({ ...user, subscriptionStatus: "canceled" });
    expect(expired["org.members"]).toBe(false);
    expect(expired["tab.organization"]).toBe(false);
    expect(expired["quotes.create"]).toBe(true);
  });

  it("ignores unknown keys and non-boolean values", () => {
    const can = resolvePermissions({
      role: "user",
      permissionConfig: { version: 2, permissions: { "jobs.delete": "yes", bogus: true } },
    });
    expect(can["jobs.delete"]).toBe(false);
    expect("bogus" in can).toBe(false);
  });

  it("uses the Executive label while keeping the existing account discriminator", () => {
    const permissions = getUserPermissions({ ...paid, role: "user" });
    expect(permissions.accountTypeLabel).toBe("Executive Account");
    expect(permissions.isManagingAccount).toBe(true);
    expect(permissions.isAdmin).toBe(false);
  });

  it("derives the older fields clients still read", () => {
    const permissions = getUserPermissions({
      role: "user",
      permissionConfig: toStoredConfig({ "quotes.create": true }),
    });
    expect(permissions.canGenerateDocuments).toBe(true);
    expect(permissions.canDeleteCoreRecords).toBe(false);
    expect(permissions.tabAccess.dashboard).toBe(true);
  });
});

describe("separate drawing permissions", () => {
  it.each([true, false])("preserves a legacy combined drawing grant of %s", (legacy) => {
    const can = resolvePermissions({ permissionConfig: { version: 2, permissions: { "drawings.manage": legacy } } });
    expect(can["drawings.view"]).toBe(true);
    expect(can["drawings.upload"]).toBe(legacy);
    expect(can["drawings.delete"]).toBe(legacy);
  });
  it("honors explicit new permissions ahead of a legacy combined grant", () => {
    const can = resolvePermissions({ permissionConfig: { version: 2, permissions: { "drawings.manage": true, "drawings.view": false, "drawings.upload": true, "drawings.delete": false } } });
    expect(can["drawings.view"]).toBe(false);
    expect(can["drawings.upload"]).toBe(true);
    expect(can["drawings.delete"]).toBe(false);
  });
  it("keeps upload and deletion independent for new member and preset configurations", () => {
    for (const key of ["drawings.upload", "drawings.delete"] as const) {
      const can = resolvePermissions({ permissionConfig: toStoredConfig({ [key]: true }) });
      expect(can[key]).toBe(true);
      expect(can[key === "drawings.upload" ? "drawings.delete" : "drawings.upload"]).toBe(false);
    }
  });
});

describe("material list permissions", () => {
  const keys = ["lists.edit", "lists.delete", "orders.send", "orders.receive"] as const;
  it.each(keys)("persists %s independently of the other three permissions", (selected) => {
    const permissions = Object.fromEntries(keys.map((key) => [key, key === selected]));
    const stored = toStoredConfig(permissions);
    const resolved = resolvePermissions({ role: "user", permissionConfig: stored });
    keys.forEach((key) => expect(resolved[key]).toBe(key === selected));
  });
});

describe("Chat page permission", () => {
  it.each([true, false])("preserves prior Jobs-based Chat access (%s) until explicitly changed", (allowed) => {
    for (const permissionConfig of [
      { version: 2, permissions: { "tab.dashboard": allowed } },
      { tabs: { dashboard: allowed } },
    ]) {
      expect(getUserPermissions({ permissionConfig }).tabAccess.chat).toBe(allowed);
    }
  });
  it.each([true, false])("lets Chat (%s) differ from Jobs", (chat) => {
    const permissionConfig = toStoredConfig({ "tab.chat": chat, "tab.dashboard": !chat });
    const access = getUserPermissions({ permissionConfig }).tabAccess;
    expect(access.chat).toBe(chat);
    expect(access.dashboard).toBe(!chat);
  });
});

it("preserves existing Sheet tool access but respects an explicit denial", () => {
  expect(resolvePermissions({ role: "user", permissionConfig: toStoredConfig({ "drawings.upload": true }) })["drawings.sheetTools"]).toBe(true);
  expect(resolvePermissions({ role: "user", permissionConfig: toStoredConfig({ "drawings.sheetTools": false, "drawings.upload": true }) })["drawings.sheetTools"]).toBe(false);
});
