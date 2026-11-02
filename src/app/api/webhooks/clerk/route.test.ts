// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  verify: vi.fn(), insert: vi.fn(), values: vi.fn(), upsert: vi.fn(),
}));
vi.mock("svix", () => ({ Webhook: class { verify = mocks.verify; } }));
vi.mock("next/headers", () => ({ headers: () => new Headers({
  "svix-id": "test-id", "svix-timestamp": "123", "svix-signature": "test-signature",
}) }));
vi.mock("~/env", () => ({ env: { CLERK_WEBHOOK_SECRET: "test-only" } }));
vi.mock("~/server/db", () => ({ db: { insert: mocks.insert } }));
vi.mock("~/server/db/schema", () => ({ users: { id: "id-column" } }));
import { POST } from "./route";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.values.mockReturnValue({ onConflictDoUpdate: mocks.upsert });
  mocks.upsert.mockResolvedValue(undefined);
});
test.each(["user.created", "user.updated"])("%s atomically upserts only identity fields", async (type) => {
  mocks.verify.mockReturnValue({ type, data: {
    id: "test-user", email_addresses: [{ email_address: "test@example.invalid" }],
    first_name: "Test", last_name: "User", image_url: null,
  } });
  const result = await POST(new Request("https://example.invalid/webhook", { method: "POST", body: "{}" }));
  expect(result.status).toBe(200);
  expect(mocks.upsert).toHaveBeenCalledOnce();
  expect(mocks.upsert).toHaveBeenCalledWith({ target: "id-column", set: {
    name: "Test User", email: "test@example.invalid", image: null,
    updatedAt: expect.any(Date) as Date,
  } });
});

afterEach(() => vi.unstubAllEnvs());
test("accepts the original production endpoint during the AWS transition", async () => {
  vi.stubEnv("CLERK_WEBHOOK_SECRET_SECONDARY", "original-test-secret");
  mocks.verify.mockImplementationOnce(() => { throw new Error("wrong primary signature"); });
  mocks.verify.mockReturnValueOnce({ type: "user.updated", data: {
    id: "test-user", email_addresses: [{ email_address: "test@example.invalid" }],
    first_name: "Test", last_name: "User", image_url: null,
  } });
  const result = await POST(new Request("https://example.invalid/webhook", { method: "POST", body: "{}" }));
  expect(result.status).toBe(200);
  expect(mocks.verify).toHaveBeenCalledTimes(2);
});
