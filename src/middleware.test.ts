// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  next: vi.fn(() => ({ kind: "next" })),
  redirect: vi.fn((url: URL) => ({ kind: "redirect", url: url.toString() })),
  auth: vi.fn(async () => ({ userId: null as string | null })),
  clerkGate: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { next: mocks.next, redirect: mocks.redirect },
}));
vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware:
    (handler: (...args: unknown[]) => unknown) =>
    (request: unknown, event: unknown) => {
      mocks.clerkGate(request);
      return handler(mocks.auth, request, event);
    },
  createRouteMatcher: (patterns: string[]) => (request: NextRequest) =>
    patterns.some((pattern) =>
      pattern.endsWith("(.*)")
        ? request.nextUrl.pathname.startsWith(pattern.slice(0, -4))
        : request.nextUrl.pathname === pattern,
    ),
}));

import middleware from "./middleware";

const SECRET = "unit-test-only-" + "x".repeat(48);
function request(path: string, header?: string, cookie?: string) {
  const url = new URL(path, "http://test.invalid");
  return {
    url: url.toString(),
    nextUrl: url,
    headers: new Headers(header ? { "x-foremenhq-agent-auth": header } : {}),
    cookies: {
      get: (name: string) =>
        name === "foremenhq_agent_auth" && cookie !== undefined
          ? { value: cookie }
          : undefined,
    },
  } as unknown as NextRequest;
}
const run = (req: NextRequest) =>
  middleware(req, {} as Parameters<typeof middleware>[1]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("FOREMENHQ_AGENT_AUTH_BYPASS", "true");
  vi.stubEnv("FOREMENHQ_AGENT_AUTH_SECRET", SECRET);
  mocks.auth.mockResolvedValue({ userId: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("middleware provider isolation", () => {
  it.each(["header", "cookie"])(
    "retired %s credentials cannot bypass Clerk, even if old configuration is enabled",
    async (mechanism) => {
      const response = await run(
        request(
          "/dashboard/jobs",
          mechanism === "header" ? SECRET : undefined,
          mechanism === "cookie" ? SECRET : undefined,
        ),
      );
      expect(response).toEqual({
        kind: "redirect",
        url: "http://test.invalid/sign-in",
      });
      expect(mocks.clerkGate).toHaveBeenCalledOnce();
      expect(mocks.auth).toHaveBeenCalledOnce();
    },
  );

  it.each(["wrong-secret", "", undefined])(
    "rejects an absent or incorrect token (%s)",
    async (token) => {
      const response = await run(request("/dashboard/jobs", token));
      expect(response).toEqual({
        kind: "redirect",
        url: "http://test.invalid/sign-in",
      });
      expect(mocks.clerkGate).toHaveBeenCalledTimes(1);
      expect(mocks.auth).toHaveBeenCalledTimes(1);
    },
  );

  it("does not authenticate using an obsolete short secret", async () => {
    vi.stubEnv("FOREMENHQ_AGENT_AUTH_SECRET", "too-short");
    const response = await run(request("/dashboard/jobs", "too-short"));
    expect(response).toEqual({
      kind: "redirect",
      url: "http://test.invalid/sign-in",
    });
    expect(mocks.clerkGate).toHaveBeenCalledTimes(1);
  });

  it("keeps ordinary authenticated protected requests Clerk-gated", async () => {
    mocks.auth.mockResolvedValue({ userId: "test-user" });
    const response = await run(request("/dashboard/jobs"));
    expect(response).toEqual({ kind: "next" });
    expect(mocks.clerkGate).toHaveBeenCalledTimes(1);
    expect(mocks.auth).toHaveBeenCalledTimes(1);
  });

  it("keeps the existing exact public health endpoint independent of Clerk", async () => {
    vi.stubEnv("FOREMENHQ_AGENT_AUTH_BYPASS", "false");
    vi.stubEnv("FOREMENHQ_AGENT_AUTH_SECRET", "");
    const response = await run(request("/api/health?probe=1"));
    expect(response).toEqual({ kind: "next" });
    expect(mocks.clerkGate).not.toHaveBeenCalled();
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it.each([
    "/api/job-documents/wopi/test-id",
    "/api/job-documents/wopi/test-id/contents",
  ])(
    "preserves independently token-authenticated WOPI callback %s",
    async (path) => {
      expect(await run(request(path))).toEqual({ kind: "next" });
      expect(mocks.clerkGate).not.toHaveBeenCalled();
    },
  );

  it("does not extend the health exemption to protected paths sharing its prefix", async () => {
    const response = await run(request("/api/health/private"));
    expect(response).toEqual({
      kind: "redirect",
      url: "http://test.invalid/sign-in",
    });
    expect(mocks.clerkGate).toHaveBeenCalledTimes(1);
    expect(mocks.auth).toHaveBeenCalledTimes(1);
  });
});
