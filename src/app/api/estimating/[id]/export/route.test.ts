// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { newEstimateDocument, newEstimateLine } from "~/lib/estimating/types";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), getEstimate: vi.fn() }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: mocks.identity,
}));
vi.mock("~/server/estimating/service", () => ({
  getEstimate: mocks.getEstimate,
}));
import { GET } from "./route";
const id = "00000000-0000-4000-8000-000000000001";
const params = { params: Promise.resolve({ id }) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({
    userId: "person",
    user: { id: "person" },
    actorUser: { id: "person" },
    simulation: null,
  });
  const document = newEstimateDocument();
  document.lines = [
    newEstimateLine({
      description: "Pipe",
      quantity: 10,
      materialUnitCost: 3,
      priceSource: "manual",
    }),
  ];
  mocks.getEstimate.mockResolvedValue({
    id,
    jobId: id,
    jobName: "Job",
    name: 'Report"\r\nInjected:bad',
    revision: 1,
    status: "draft",
    document,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});
it("denies signed-out downloads before accessing an estimate", async () => {
  mocks.identity.mockResolvedValue({ userId: null, user: null });
  const result = await GET(
    new Request("https://app.test/api/estimating/" + id + "/export"),
    params,
  );
  expect(result.status).toBe(401);
  expect(mocks.getEstimate).not.toHaveBeenCalled();
});
it("preserves server permission denial on all export formats", async () => {
  mocks.getEstimate.mockRejectedValue(
    new TRPCError({ code: "FORBIDDEN", message: "Dollar values hidden" }),
  );
  for (const format of ["csv", "xlsx", "pdf"]) {
    const result = await GET(
      new Request("https://app.test/export?format=" + format),
      params,
    );
    expect(result.status).toBe(403);
  }
});
it("returns safe private download headers and validates export inputs", async () => {
  const result = await GET(
    new Request("https://app.test/export?format=csv&view=proposal"),
    params,
  );
  expect(result.status).toBe(200);
  expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  expect(result.headers.get("Content-Disposition")).not.toContain("\n");
  expect(await result.text()).toContain("Pipe");
  const bad = await GET(
    new Request("https://app.test/export?format=javascript"),
    params,
  );
  expect(bad.status).toBe(400);
});
