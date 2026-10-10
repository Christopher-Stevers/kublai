// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/utils/seed-organization", () => ({ seedOrganization: vi.fn() }));

import { organizationRouter } from "./organization";
import type { createTRPCContext } from "~/server/api/trpc";
import {
  PERMISSION_PRESETS,
  matchingPreset,
  type PermissionMap,
} from "~/lib/permission-catalog";
import { toStoredConfig } from "~/server/auth/permissions";

const organizationId = "00000000-0000-4000-8000-000000000001";
const journeyman = PERMISSION_PRESETS.find((p) => p.id === "journeyman")!;

function setup() {
  const inserted: Array<Record<string, unknown>> = [];
  const db = {
    insert: vi.fn(() => ({
      values: (values: Record<string, unknown>) => {
        inserted.push(values);
        return { returning: async () => [{ id: "invite-1", ...values }] };
      },
    })),
  };
  const context = {
    db,
    userId: "actor",
    user: {
      id: "actor",
      organizationId,
      organizationAccessStatus: "approved",
      role: "user",
      permissionConfig: toStoredConfig({ "org.invite": true, "tab.dashboard": true }),
    },
    headers: new Headers(),
  } as unknown as Awaited<ReturnType<typeof createTRPCContext>>;
  return { caller: organizationRouter.createCaller(context), inserted };
}

afterEach(() => vi.useRealTimers());

describe("QR invites", () => {
  it("offers Journeyman with the permissions from Tim's Journeyman invite, replacing Field worker", () => {
    expect(PERMISSION_PRESETS.map((p) => p.label)).toEqual([
      "Manager",
      "Foreman",
      "Journeyman",
      "Tool room",
      "View only",
    ]);
    const allowed = Object.entries(journeyman.permissions)
      .filter(([, on]) => on)
      .map(([key]) => key)
      .sort();
    expect(allowed).toEqual([
      "drawings.view",
      "financial.view",
      "lists.edit",
      "orders.receive",
      "parts.create",
      "parts.edit",
      "tab.dashboard",
      "tab.orders",
      "tab.timesheets",
      "timesheets.edit",
    ]);
    expect(matchingPreset({ ...journeyman.permissions } as PermissionMap)?.label).toBe("Journeyman");
  });

  it("expires after the chosen number of days, defaulting to a week", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-05T12:00:00Z") });
    const day = 24 * 60 * 60 * 1000;
    const test = setup();
    await test.caller.createOrganizationInvite({ name: "Crew", permissions: journeyman.permissions, expiresInDays: 30 });
    await test.caller.createOrganizationInvite({ name: "Crew", permissions: journeyman.permissions });
    expect((test.inserted[0]!.expiresAt as Date).getTime()).toBe(Date.now() + 30 * day);
    expect((test.inserted[1]!.expiresAt as Date).getTime()).toBe(Date.now() + 7 * day);
  });

  it("rejects expiry periods that aren't offered", async () => {
    const test = setup();
    await expect(
      test.caller.createOrganizationInvite({ name: "Crew", permissions: journeyman.permissions, expiresInDays: 365 as 7 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(test.inserted).toHaveLength(0);
  });
});
