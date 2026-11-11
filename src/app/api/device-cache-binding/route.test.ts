import { afterEach, describe, expect, it, vi } from "vitest";
const identity = vi.hoisted(() => vi.fn());
vi.mock("~/server/utils/get-request-identity", () => ({ getRequestIdentity: identity }));
import { GET } from "./route";
afterEach(() => vi.unstubAllEnvs());
describe("device cache binding", () => {
  it("rejects signed-out and organization-revoked identities", async () => {
    for (const value of [{userId:null,user:null}, {userId:"u",user:{organizationId:"o",organizationAccessStatus:"pending"}}]) {
      identity.mockResolvedValue(value);
      expect((await GET(new Request("https://app.local/api/device-cache-binding"))).status).toBe(403);
    }
  });
  it("returns the freshly resolved simulated identity and build without caching", async () => {
    vi.stubEnv("NEXT_PUBLIC_BUILD_ID", "a".repeat(64));
    identity.mockResolvedValue({userId:"effective",user:{organizationId:"org",organizationAccessStatus:"approved"},simulation:{id:"session"}});
    const response = await GET(new Request("https://app.local/api/device-cache-binding"));
    expect(await response.json()).toEqual({account:"org:effective:simulation:session",build:"a".repeat(64)});
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
  });
});
