import { describe, expect, it } from "vitest";

import { PERMISSION_KEYS } from "~/lib/permission-catalog";
import { getUserPermissions, resolvePermissions, toStoredConfig } from "./permissions";

const paid = { stripeSubscriptionId: "sub_1", subscriptionStatus: "active" };

describe("resolvePermissions", () => {
  it("gives admins everything, whatever is stored", () => {
    const can = resolvePermissions({ role: "admin", permissionConfig: toStoredConfig({ "jobs.delete": false }) });
    expect(PERMISSION_KEYS.every((k) => can[k])).toBe(true);
  });

  it("keeps the old behaviour for standard accounts with no or legacy config", () => {
    const can = resolvePermissions({ role: "user" });
    expect(can["parts.create"]).toBe(true);
    expect(can["jobs.delete"]).toBe(false);
    expect(can["orders.send"]).toBe(false);
    expect(can["tab.draws"]).toBe(false);
    const legacy = resolvePermissions({
      role: "user",
      permissionConfig: { tabs: { catalogue: false }, actions: { canEditParts: false, canDelete: true, canManageAssets: true } },
    });
    expect(legacy["tab.catalogue"]).toBe(false);
    expect(legacy["parts.edit"]).toBe(false);
    expect(legacy["parts.delete"]).toBe(true);
    expect(legacy["assets.manage"]).toBe(true);
  });

  it("keeps the old behaviour for paid seats with legacy config (config ignored except tool room)", () => {
    const can = resolvePermissions({ ...paid, role: "user", permissionConfig: { tabs: { catalogue: false } } });
    expect(can["tab.catalogue"]).toBe(true);
    expect(can["orders.send"]).toBe(true);
    expect(can["org.members"]).toBe(true);
    expect(can["assets.manage"]).toBe(false);
  });

  it("applies version 2 settings to every non-admin, including paid seats", () => {
    const config = toStoredConfig({ "jobs.delete": false, "orders.send": false, "assets.manage": true });
    const seat = resolvePermissions({ ...paid, role: "user", permissionConfig: config });
    expect(seat["jobs.delete"]).toBe(false);
    expect(seat["orders.send"]).toBe(false);
    expect(seat["assets.manage"]).toBe(true);
    expect(seat["quotes.create"]).toBe(true); // not stored: paid-seat default
    const field = resolvePermissions({ role: "user", permissionConfig: toStoredConfig({ "tab.draws": true, "draws.edit": true }) });
    expect(field["tab.draws"]).toBe(true);
    expect(field["draws.edit"]).toBe(true);
    expect(field["orders.send"]).toBe(false);
  });

  it("ignores unknown keys and non-boolean values", () => {
    const can = resolvePermissions({ role: "user", permissionConfig: { version: 2, permissions: { "jobs.delete": "yes", bogus: true } } });
    expect(can["jobs.delete"]).toBe(false);
    expect("bogus" in can).toBe(false);
  });

  it("derives the older fields clients still read", () => {
    const p = getUserPermissions({ role: "user", permissionConfig: toStoredConfig({ "quotes.create": true }) });
    expect(p.canGenerateDocuments).toBe(true);
    expect(p.canDeleteCoreRecords).toBe(false);
    expect(p.tabAccess.dashboard).toBe(true);
  });
});
