// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/env", () => ({ env: { STRIPE_SECRET_KEY: "test-only" } }));
const stripeConstructor = vi.hoisted(() => vi.fn());
vi.mock("stripe", () => ({ default: stripeConstructor }));
import { paymentRouter } from "./payment";
import type { createTRPCContext } from "~/server/api/trpc";
const caller = paymentRouter.createCaller({
  userId: "test-user", user: { id: "test-user" }, headers: new Headers(), db: {},
} as unknown as Awaited<ReturnType<typeof createTRPCContext>>);
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
test.each([undefined, "false", "TRUE"])("checkout fails closed with flag %s before contacting Stripe", async (value) => {
  vi.stubEnv("STRIPE_CHECKOUT_ENABLED", value);
  expect(await caller.getCheckoutAvailability()).toEqual({ enabled: false });
  await expect(caller.createSubscriptionCheckout()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(stripeConstructor).not.toHaveBeenCalled();
});
test("checkout is advertised only when explicitly enabled", async () => {
  vi.stubEnv("STRIPE_CHECKOUT_ENABLED", "true");
  expect(await caller.getCheckoutAvailability()).toEqual({ enabled: true });
});
