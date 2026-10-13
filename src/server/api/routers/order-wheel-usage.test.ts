// @vitest-environment node
import { expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/material-list-events", () => ({
  publishOrganizationCatalogueEvent: vi.fn(),
}));
import { catalogueRouter } from "./catalogue";
import type { createTRPCContext } from "~/server/api/trpc";
it("scopes recent sent-order signals to the authenticated employee and organization", async () => {
  const execute = vi.fn(async (_query: SQL) => []);
  const context = {
    db: { execute },
    userId: "employee-a",
    user: {
      id: "employee-a",
      organizationId: "00000000-0000-4000-8000-000000000001",
      role: "user",
      organizationAccessStatus: "approved",
      permissionConfig: {},
    },
    headers: new Headers(),
  } as unknown as Awaited<ReturnType<typeof createTRPCContext>>;
  expect(
    await catalogueRouter.createCaller(context).recentOrderWheelUsage(),
  ).toEqual({});
  const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
  expect(query.params).toContain("employee-a");
  expect(query.params).toContain(context.user!.organizationId);
  expect(query.sql).toContain("select distinct o.id as order_id");
  expect(query.sql).toContain("o.status in ('sent', 'confirmed', 'received')");
  expect(query.sql).toContain("o.kind = 'materials'");
  expect(query.sql).toContain('o."sentAt" >=');
  expect(query.sql).toContain("oi.quantity > 0");
  const cutoff = query.params.find(
    (v) => typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v),
  );
  expect(
    Math.abs(Date.now() - new Date(cutoff as string).getTime() - 60 * 86400000),
  ).toBeLessThan(5000);
});
