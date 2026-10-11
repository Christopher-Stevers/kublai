// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  vi.stubEnv("FOREMENHQ_AGENT_AUTH_BYPASS", "true");
  vi.stubEnv("FOREMENHQ_AGENT_AUTH_SECRET", "retired-secret-" + "x".repeat(48));
  vi.stubEnv("FOREMENHQ_BETA_ACCESS_CODE", "configured-old-code");
});
afterEach(() => vi.unstubAllEnvs());

describe("retired beta login", () => {
  it.each(["", "foremen2024", "configured-old-code", "invalid"])(
    "redirects code %s to normal sign-in and only expires legacy cookies",
    (code) => {
      const response = GET(
        new NextRequest(
          "https://app.example.test/beta?code=" + encodeURIComponent(code),
          {
            headers: {
              cookie: "foremenhq_agent_auth=old; foremenhq_beta_access=1",
              "x-forwarded-host": "attacker.example.test",
            },
          },
        ),
      );
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "https://app.example.test/sign-in",
      );
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.cookies.getAll()).toHaveLength(2);
      for (const name of ["foremenhq_agent_auth", "foremenhq_beta_access"]) {
        const cookie = response.cookies.get(name);
        expect(cookie?.value).toBe("");
        expect(cookie?.expires).toEqual(new Date(0));
        expect(cookie?.path).toBe("/");
      }
    },
  );

  it("uses the current request origin when no app origin is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const response = GET(new NextRequest("https://app.example.test/beta"));
    expect(response.headers.get("location")).toBe(
      "https://app.example.test/sign-in",
    );
  });
});
