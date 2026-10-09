// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  ensureUser: vi.fn(),
  validAgent: vi.fn(),
  agentUser: vi.fn(),
  devUser: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("~/server/utils/ensure-user", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("~/server/utils/get-agent-bypass-user", () => ({
  hasValidAgentAuthBypass: mocks.validAgent,
  getAgentBypassUser: mocks.agentUser,
}));
vi.mock("~/server/utils/get-dev-bypass-user", () => ({
  getDevBypassUser: mocks.devUser,
}));

import { getRequestIdentity } from "./get-request-identity";

const localUser = { id: "local-user", organizationId: "organization" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.validAgent.mockReturnValue(false);
  mocks.auth.mockResolvedValue({ userId: null });
  mocks.devUser.mockResolvedValue(null);
});

test("a validated agent request resolves its local user without Clerk", async () => {
  const headers = new Headers({ "x-agent-auth": "test-only" });
  mocks.validAgent.mockReturnValue(true);
  mocks.agentUser.mockResolvedValue(localUser);
  expect(await getRequestIdentity(headers, { allowDev: true })).toMatchObject({
    userId: localUser.id,
    user: localUser,
  });
  expect(mocks.validAgent).toHaveBeenCalledWith(headers);
  expect(mocks.agentUser).toHaveBeenCalledWith(headers);
  expect(mocks.auth).not.toHaveBeenCalled();
  expect(mocks.ensureUser).not.toHaveBeenCalled();
  expect(mocks.devUser).not.toHaveBeenCalled();
});

test("a valid agent token with no account stays unauthenticated without any fallback", async () => {
  mocks.validAgent.mockReturnValue(true);
  mocks.agentUser.mockResolvedValue(null);
  mocks.devUser.mockResolvedValue(localUser);
  mocks.auth.mockResolvedValue({ userId: "unexpected-clerk-user" });
  expect(
    await getRequestIdentity(new Headers(), { allowDev: true }),
  ).toMatchObject({
    userId: null,
    user: null,
  });
  expect(mocks.auth).not.toHaveBeenCalled();
  expect(mocks.ensureUser).not.toHaveBeenCalled();
  expect(mocks.devUser).not.toHaveBeenCalled();
});

test("ordinary signed-in requests resolve the Clerk account", async () => {
  mocks.auth.mockResolvedValue({ userId: "clerk-user" });
  mocks.ensureUser.mockResolvedValue(localUser);
  expect(
    await getRequestIdentity(new Headers(), { allowDev: true }),
  ).toMatchObject({
    userId: "clerk-user",
    user: localUser,
  });
  expect(mocks.ensureUser).toHaveBeenCalledWith("clerk-user");
  expect(mocks.agentUser).not.toHaveBeenCalled();
  expect(mocks.devUser).not.toHaveBeenCalled();
});

test("signed-out requests preserve the explicitly enabled development fallback", async () => {
  mocks.devUser.mockResolvedValue(localUser);
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
  mocks.devUser.mockResolvedValue(localUser);
  expect(await getRequestIdentity(new Headers())).toMatchObject({
    userId: null,
    user: null,
  });
  expect(mocks.devUser).not.toHaveBeenCalled();
});
