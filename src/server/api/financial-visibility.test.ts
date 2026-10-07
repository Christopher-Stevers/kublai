// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
import { createTRPCRouter, hasDashboardAccess, type createTRPCContext } from "./trpc";
import { getUserPermissions, toStoredConfig } from "~/server/auth/permissions";

const router = createTRPCRouter({
  list: hasDashboardAccess.query(() => ({ itemCount: 5, materialTotal: 189.5,
    quote: { total: "189.5", items: [{ unitCost: "37.9", quantity: "5" }] } })),
  edit: hasDashboardAccess.mutation(() => ({ unitCost: "37.9", quantity: "5" })),
  role: hasDashboardAccess.query(({ ctx }) => getUserPermissions(ctx.user)),
});
function caller(visible: boolean, executive = false) {
  const user = { id: "member", organizationId: "company", organizationAccessStatus: "approved",
    role: "user", permissionConfig: toStoredConfig({ "financial.view": visible, "tab.draws": true }),
    ...(executive ? { stripeSubscriptionId: "sub", subscriptionStatus: "active" } : {}) };
  return router.createCaller({ user, userId: user.id, db: {}, headers: new Headers() } as unknown as Awaited<ReturnType<typeof createTRPCContext>>);
}
describe("server financial visibility", () => {
  it("masks both query and mutation results using the authenticated member permission", async () => {
    expect(await caller(false).list()).toEqual({ itemCount: 5, materialTotal: 0,
      quote: { total: "", items: [{ unitCost: "", quantity: "5" }] } });
    expect(await caller(false).edit()).toEqual({ unitCost: "", quantity: "5" });
    const role = await caller(false).role();
    expect(role.can["financial.view"]).toBe(false);
    expect(role.tabAccess.draws).toBe(false);
    expect(role.tabAccess.dashboard).toBe(true);
  });
  it("preserves normal prices and Executive entitlement", async () => {
    expect((await caller(true).list()).materialTotal).toBe(189.5);
    expect((await caller(false, true).list()).materialTotal).toBe(189.5);
    expect((await caller(false, true).role()).can["financial.view"]).toBe(true);
  });
});
