// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SlipLine } from "~/lib/packing-slip-review";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  transaction: vi.fn(),
  update: vi.fn(),
  save: vi.fn(),
  insert: vi.fn(),
}));
vi.mock("~/server/db", () => ({
  db: { transaction: mocks.transaction, update: mocks.update },
}));
vi.mock("./trace", () => ({
  recordPipelineStage: vi.fn(),
  recordModelCall: vi.fn(),
}));
vi.mock("./terra-fallback", async (original) => ({
  ...(await original<typeof import("./terra-fallback")>()),
  readTerraFallback: mocks.read,
}));
import { productionCascade } from "./production-cascade";
const source: SlipLine = {
  page: 1,
  evidence: "ABC Valve",
  description: "Valve",
  sku: "ABC",
  shipped: null,
  backordered: 4,
  unit: "ea",
  orderItemId: "item",
  proposed: null,
  issues: ["Shipped quantity could not be read confidently."],
  box: { x: 0, y: 0.2, width: 1, height: 0.1 },
};
const args = () => ({
  scope: {
    runId: "run",
    organizationId: "org",
    jobId: "job",
    documentId: "doc",
    versionId: "version",
    sourceHash: "a".repeat(64),
  },
  base: { lines: [structuredClone(source)], warnings: [], model: "jev-1.14.0" },
  pages: [Buffer.from("fixture")],
  unresolvedOrder: false,
  context: vi.fn(async () => ({
    orders: [],
    candidatePoolComplete: true,
    linkedOrderId: null,
    reasons: ["Unreadable shipped quantities"],
    earlierLines: [],
  })),
  assertCurrent: vi.fn(async () => undefined),
  progress: vi.fn(async () => undefined),
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "fixture");
  vi.stubEnv("PACKING_SLIP_TERRA_ENABLED", "true");
  vi.stubEnv("PACKING_SLIP_TERRA_ORGANIZATIONS", "org");
  mocks.save.mockResolvedValue(undefined);
  mocks.update.mockReturnValue({ set: () => ({ where: mocks.save }) });
  mocks.transaction.mockImplementation(
    async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        execute: vi.fn(),
        select: vi
          .fn()
          .mockReturnValueOnce({
            from: () => ({ where: () => ({ limit: async () => [] }) }),
          })
          .mockReturnValueOnce({
            from: () => ({ where: async () => [{ spent: 0, calls: 0 }] }),
          }),
        insert: () => ({ values: mocks.insert }),
      }),
  );
  mocks.read.mockResolvedValue({
    model: "gpt-6.1-terra",
    usage: { estimatedUsd: 0.02 },
    durationMs: 10,
    output: {
      orderId: null,
      orderConfidence: 0,
      document: {
        kind: "delivery",
        supplierName: null,
        deliveryNumber: null,
        supplierOrderNumber: null,
        deliveryDate: null,
      },
      lines: [
        {
          ...source,
          shipped: 6,
          ordered: 10,
          handwritten: null,
          confidence: {
            part: 0.9,
            quantity: 0.9,
            match: 0.9,
            overall: 0.9,
            reason: "Fixture",
          },
          issues: [],
        },
      ],
      warnings: [],
    },
  });
});
afterEach(() => vi.unstubAllEnvs());
it("never calls Terra or its budget store for a clear cheap reading", async () => {
  const input = args();
  input.base.lines = [{ ...source, shipped: 6, proposed: 6, issues: [] }];
  const result = await productionCascade(input);
  expect(result.cascade.status).toBe("not-needed");
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(input.context).not.toHaveBeenCalled();
});
it("only enables the configured organization and requires current access", async () => {
  const input = args();
  input.scope.organizationId = "other-org";
  expect((await productionCascade(input)).cascade.status).toBe("unavailable");
  const revoked = args();
  revoked.assertCurrent.mockRejectedValue(Error("revoked"));
  expect((await productionCascade(revoked)).cascade.status).toBe("failed");
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it("retains earlier predictions on provider errors and never retries", async () => {
  mocks.read.mockRejectedValue(Error("private provider response"));
  const input = args(),
    result = await productionCascade(input);
  expect(result.cascade.status).toBe("failed");
  expect(result.lines).toEqual(input.base.lines);
  expect(JSON.stringify(result)).not.toContain("private provider response");
  expect(mocks.read).toHaveBeenCalledTimes(1);
});
it("records an assisted reading but never produces an approved receipt", async () => {
  const input = args(),
    result = await productionCascade(input);
  expect(result.cascade.status).toBe("completed");
  expect(result.cascade.estimatedUsd).toBe(0.02);
  expect(result.lines[0]).toMatchObject({
    source: "terra",
    shipped: 6,
    proposed: null,
    quantityClear: false,
  });
  expect(input.base.lines[0]!.shipped).toBeNull();
  expect(result.lines[0]!.issues.join()).toMatch(/Verify the source/);
});
