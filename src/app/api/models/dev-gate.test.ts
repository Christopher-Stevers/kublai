// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
const identity = vi.hoisted(() => vi.fn());
vi.mock("~/server/utils/get-request-identity", () => ({ getRequestIdentity: identity }));
vi.mock("~/server/models/storage", () => ({}));
vi.mock("~/server/models/service", () => ({}));
vi.mock("~/server/models/access", () => ({}));
import { POST as upload } from "./upload/route";
import { PUT as chunk, POST as finish } from "./upload/[uploadId]/[part]/route";
import { GET as file, HEAD as head } from "./files/[modelId]/route";
import { GET as kernel } from "./kernel/manifold-3.5.4.js/route";
import { GET as manifold } from "./wasm/manifold-3.5.4.wasm/route";
import { GET as ifc } from "./wasm/web-ifc.wasm/route";

afterEach(() => vi.unstubAllEnvs());
it("blocks model upload, finish, file downloads and viewer engines before auth or storage", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("FOREMANHQ_DEV_FEATURES", undefined);
  const request = new Request("https://app.test/api/models");
  const parts = { params: Promise.resolve({ uploadId: "id", part: "finish" }) };
  const model = { params: Promise.resolve({ modelId: "id" }) };
  for (const response of await Promise.all([
    upload(request), chunk(request, parts), finish(request, parts),
    file(request, model), head(request, model), kernel(), manifold(), ifc(),
  ])) {
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(identity).not.toHaveBeenCalled();
});
