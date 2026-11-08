// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
import { assetsRouter } from "./assets";
import { drawsRouter } from "./draws";
import { estimatingRouter } from "./estimating";
import { timesheetsRouter } from "./timesheets";
import { createTRPCRouter, hasAppAccess, hasDevAppAccess } from "../trpc";
const context = {
  db: {}, headers: new Headers(), userId: "admin",
  user: { id: "admin", organizationId: "org", organizationAccessStatus: "approved", role: "admin" },
} as never;
afterEach(() => vi.unstubAllEnvs());
for (const [name, router] of Object.entries({ assetsRouter, drawsRouter, estimatingRouter, timesheetsRouter })) {
  it(`blocks every ${name} procedure in production, even for an administrator`, async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FOREMANHQ_DEV_FEATURES", undefined);
    const caller = router.createCaller(context) as unknown as Record<string, () => Promise<unknown>>;
    for (const procedure of Object.keys(router._def.procedures)) {
      await expect(caller[procedure]!()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });
}
it("keeps standard app procedures available while allowing explicit dev opt-in", async () => {
  vi.stubEnv("FOREMANHQ_DEV_FEATURES", "false");
  const caller = createTRPCRouter({ normal: hasAppAccess.query(() => "available"), dev: hasDevAppAccess.query(() => "available") }).createCaller(context);
  expect(await caller.normal()).toBe("available");
  await expect(caller.dev()).rejects.toMatchObject({ code: "NOT_FOUND" });
  vi.stubEnv("FOREMANHQ_DEV_FEATURES", "true");
  expect(await caller.dev()).toBe("available");
});
