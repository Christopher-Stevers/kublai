// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/utils/seed-organization", () => ({ seedOrganization: vi.fn() }));
vi.mock("~/server/simulation/service", () => ({ recordSimulationAction: vi.fn(async () => null) }));
import { organizationRouter } from "./organization";
import { liveAccountScope } from "~/lib/live-protocol";
import { STANDARD_DEFAULTS } from "~/lib/permission-catalog";
import type { createTRPCContext } from "~/server/api/trpc";

const transaction = vi.fn(() => { throw new Error("reached database"); });
function caller(userId = "actor", organizationId = "org", simulation: { id: string } | null = null, role = "admin") {
  return organizationRouter.createCaller({
    db: { transaction }, userId, simulation,
    user: { id: userId, organizationId, organizationAccessStatus: "approved", role },
    headers: new Headers(),
  } as unknown as Awaited<ReturnType<typeof createTRPCContext>>);
}
const input = { userId: "target", accessStatus: "approved" as const, permissions: STANDARD_DEFAULTS };
beforeEach(() => vi.clearAllMocks());

it.each([
  ["other", "org", null, "org:actor"],
  ["actor", "other-org", null, "org:actor"],
  ["actor", "org", { id: "sim" }, "org:actor"],
  ["actor", "org", null, "org:actor:simulation:sim"],
  ["actor", "org", { id: "next" }, "org:actor:simulation:sim"],
] as const)("rejects mismatched actor/org/simulation before a write (%s/%s)", async (user, org, simulation, expectedAccountKey) => {
  await expect(caller(user, org, simulation).updateOrganizationMember({ ...input, expectedAccountKey })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(transaction).not.toHaveBeenCalled();
});
it("keeps exact identity and legacy clients subject to the existing DB path", async () => {
  await expect(caller().updateOrganizationMember({ ...input, expectedAccountKey: liveAccountScope("org", "actor") })).rejects.toThrow("reached database");
  await expect(caller().updateOrganizationMember(input)).rejects.toThrow("reached database");
  await expect(caller("actor", "org", { id: "sim" }).updateOrganizationMember({ ...input, expectedAccountKey: liveAccountScope("org", "actor", "sim") })).rejects.toThrow("reached database");
  expect(transaction).toHaveBeenCalledTimes(3);
});
it("does not grant member-edit rights from a matching identity", async () => {
  await expect(caller("actor", "org", null, "user").updateOrganizationMember({ ...input, expectedAccountKey: "org:actor" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(transaction).not.toHaveBeenCalled();
});
