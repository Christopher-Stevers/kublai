// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  ensureUser: vi.fn(),
  devUser: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("~/server/utils/ensure-user", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("~/server/utils/get-dev-bypass-user", () => ({
  getDevBypassUser: mocks.devUser,
}));

import { getRequestIdentity } from "./get-request-identity";

const localUser = { id: "local-user", organizationId: "organization" };
const clerkUser = { id: "clerk-user", organizationId: "organization" };
const oldToken = "test-only-retired-token-" + "x".repeat(40);
const oldHeaders = () =>
  new Headers({
    "x-foremenhq-agent-auth": oldToken,
    cookie: `foremenhq_agent_auth=${oldToken}; foremenhq_beta_access=1`,
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("FOREMENHQ_AGENT_AUTH_BYPASS", "true");
  vi.stubEnv("FOREMENHQ_AGENT_AUTH_SECRET", oldToken);
  mocks.auth.mockResolvedValue({ userId: null });
  mocks.devUser.mockResolvedValue(localUser);
});
afterEach(() => vi.unstubAllEnvs());

test("legacy tokens cannot establish a production identity, even with old flags enabled", async () => {
  expect(
    await getRequestIdentity(oldHeaders(), { allowDev: true }),
  ).toMatchObject({
    userId: null,
    user: null,
    actorUser: null,
    simulation: null,
  });
  expect(mocks.auth).toHaveBeenCalledOnce();
  expect(mocks.ensureUser).not.toHaveBeenCalled();
  expect(mocks.devUser).not.toHaveBeenCalled();
});

test("a legacy cookie without its beta marker cannot select another account", async () => {
  const headers = new Headers({ cookie: `foremenhq_agent_auth=${oldToken}` });
  expect(await getRequestIdentity(headers, { allowDev: true })).toMatchObject({
    userId: null,
    user: null,
  });
  expect(mocks.auth).toHaveBeenCalledOnce();
  expect(mocks.devUser).not.toHaveBeenCalled();
});

test("legacy credentials cannot override a legitimate signed-in Clerk identity", async () => {
  mocks.auth.mockResolvedValue({ userId: clerkUser.id });
  mocks.ensureUser.mockResolvedValue(clerkUser);
  expect(
    await getRequestIdentity(oldHeaders(), { allowDev: true }),
  ).toMatchObject({
    userId: clerkUser.id,
    user: clerkUser,
    actorUser: clerkUser,
  });
  expect(mocks.ensureUser).toHaveBeenCalledWith(clerkUser.id);
  expect(mocks.devUser).not.toHaveBeenCalled();
});

test("ordinary signed-in requests resolve the Clerk account", async () => {
  mocks.auth.mockResolvedValue({ userId: clerkUser.id });
  mocks.ensureUser.mockResolvedValue(clerkUser);
  expect(
    await getRequestIdentity(new Headers(), { allowDev: true }),
  ).toMatchObject({
    userId: clerkUser.id,
    user: clerkUser,
  });
  expect(mocks.ensureUser).toHaveBeenCalledWith(clerkUser.id);
  expect(mocks.devUser).not.toHaveBeenCalled();
});

test("signed-out requests preserve an explicitly enabled development-only fallback", async () => {
  vi.stubEnv("NODE_ENV", "development");
  expect(
    await getRequestIdentity(new Headers(), { allowDev: true }),
  ).toMatchObject({
    userId: localUser.id,
    user: localUser,
  });
  expect(mocks.auth).toHaveBeenCalledOnce();
  expect(mocks.devUser).toHaveBeenCalledOnce();
  expect(mocks.ensureUser).not.toHaveBeenCalled();
});

test("development fallback is disabled by default", async () => {
  vi.stubEnv("NODE_ENV", "development");
  expect(await getRequestIdentity(new Headers())).toMatchObject({
    userId: null,
    user: null,
  });
  expect(mocks.devUser).not.toHaveBeenCalled();
});
