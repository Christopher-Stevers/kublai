// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { verifyApsCredentials } from "./translation";

afterEach(() => vi.unstubAllGlobals());

it("verifies Autodesk credentials without exposing provider error bodies", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response("private provider details", { status: 401 }),
    );
  vi.stubGlobal("fetch", fetch);
  await expect(
    verifyApsCredentials({ clientId: "client", clientSecret: "secret" }),
  ).rejects.toThrow(
    "Autodesk authentication failed. Check the client ID and secret.",
  );
});

it("rejects a successful authentication response without a token", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ expires_in: 3600 })),
  );
  await expect(
    verifyApsCredentials({ clientId: "client", clientSecret: "secret" }),
  ).rejects.toThrow("Autodesk returned an invalid access token.");
});

it("continues to authenticate the retained Autodesk connection setting", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      Response.json({ access_token: "test-token", expires_in: 3600 }),
    );
  vi.stubGlobal("fetch", fetch);
  const result = await verifyApsCredentials({
    clientId: "client",
    clientSecret: "secret",
  });
  expect(result).toMatchObject({ value: "test-token", clientId: "client" });
  const [url, options] = fetch.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://developer.api.autodesk.com/authentication/v2/token");
  expect(options.method).toBe("POST");
  expect(new Headers(options.headers).get("Authorization")).toBe("Basic " + Buffer.from("client:secret").toString("base64"));
});
