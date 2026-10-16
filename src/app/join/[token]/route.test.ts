// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), invite: {} as Record<string, unknown>, updates: [] as Array<Record<string, unknown>> }));
vi.mock("~/server/utils/get-request-identity", () => ({ getRequestIdentity: mocks.identity }));
vi.mock("~/server/db", () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [mocks.invite] }) }) }),
  update: () => ({ set: (value: Record<string, unknown>) => { mocks.updates.push(value); return { where: () => Promise.resolve(undefined) }; } }),
} }));
import { GET } from "./route";
import { makeSnapshotSource } from "~/lib/snapshot-source";
const alma = makeSnapshotSource("/dashboard/jobs/0391aed4-7773-47ec-9141-09df373ec008", { version: 1 }, "Alma Phase #2");
beforeEach(() => {
  mocks.updates.length = 0;
  mocks.identity.mockResolvedValue({ userId: "new-member", user: { id: "new-member", organizationId: null } });
  mocks.invite = { organizationId: "org-1", role: "user", permissionConfig: { version: 2, permissions: {} }, defaultLandingPage: alma };
});
it("copies the invite default and opens Alma for a joining user", async () => {
  const response = await GET(new Request("https://example.com/join/invite"), { params: Promise.resolve({ token: "invite" }) });
  expect(mocks.updates[0]).toMatchObject({ defaultLandingPage: alma, organizationId: "org-1" });
  expect(new URL(response.headers.get("location")!).pathname).toBe("/dashboard/jobs/0391aed4-7773-47ec-9141-09df373ec008");
});
it("does not overwrite an existing member's saved default", async () => {
  mocks.identity.mockResolvedValue({ userId: "member", user: { id: "member", organizationId: "org-1", defaultLandingPage: alma } });
  await GET(new Request("https://example.com/join/invite"), { params: Promise.resolve({ token: "invite" }) });
  expect(mocks.updates[0]).not.toHaveProperty("defaultLandingPage");
});
it("rejects an external default destination", async () => {
  mocks.invite.defaultLandingPage = { ...alma, href: "https://example.com/phishing" };
  const response = await GET(new Request("https://example.com/join/invite"), { params: Promise.resolve({ token: "invite" }) });
  expect(mocks.updates[0]).not.toHaveProperty("defaultLandingPage");
  expect(new URL(response.headers.get("location")!).pathname).toBe("/dashboard");
});
