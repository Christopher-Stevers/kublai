// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assertSameOrigin, documentHttpError, readBoundedBody } from "./http";
import { TRPCError } from "@trpc/server";

describe("Document HTTP boundaries", () => {
  it("rejects foreign origin and cross-site writes, allows same public Host behind Next proxy", () => {
    expect(() =>
      assertSameOrigin(
        new Request("http://localhost:3000/api/job-documents", {
          headers: {
            host: "hq.example.com",
            "x-forwarded-proto": "https",
            origin: "https://hq.example.com",
          },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertSameOrigin(
        new Request("https://hq.example.com/api", {
          headers: { origin: "https://attacker.example.com" },
        }),
      ),
    ).toThrow("Cross-origin");
    expect(() =>
      assertSameOrigin(
        new Request("https://hq.example.com/api", {
          headers: { "sec-fetch-site": "cross-site" },
        }),
      ),
    ).toThrow("Cross-origin");
    expect(() =>
      assertSameOrigin(
        new Request("https://hq.example.com/api", {
          headers: {
            "x-forwarded-host": "attacker.example.com",
            origin: "https://attacker.example.com",
          },
        }),
      ),
    ).toThrow("Cross-origin");
  });
  it("bounds bodies even when the client lies about length or omits it", async () => {
    await expect(
      readBoundedBody(
        new Request("https://hq.example.com", {
          method: "POST",
          body: "large",
          headers: { "content-length": "1" },
        }),
        4,
      ),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    await expect(
      readBoundedBody(
        new Request("https://hq.example.com", {
          method: "POST",
          body: "large",
        }),
        4,
      ),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    await expect(
      readBoundedBody(
        new Request("https://hq.example.com", {
          method: "POST",
          body: "ok",
          headers: { "content-length": "200" },
        }),
        4,
      ),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(
      (
        await readBoundedBody(
          new Request("https://hq.example.com", {
            method: "POST",
            body: "okay",
          }),
          4,
        )
      ).toString(),
    ).toBe("okay");
  });
  it("maps conflicts and permission errors without caching sensitive responses", async () => {
    const response = documentHttpError(
      new TRPCError({ code: "CONFLICT", message: "New revision exists" }),
    );
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ error: "New revision exists" });
    expect(documentHttpError(new TRPCError({ code: "FORBIDDEN" })).status).toBe(
      403,
    );
  });
});
