// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  fallbackLines,
  validateFallback,
  readTerraFallback,
  terraUsage,
  boundedResponse,
  TERRA_MODEL,
  type FallbackInput,
} from "./terra-fallback";
vi.mock("./trace", () => ({ recordModelCall: vi.fn() }));
const context: FallbackInput = {
  orders: [
    {
      id: "order-a",
      orderNumber: "PO-1",
      supplier: "Fixture",
      items: [
        {
          id: "item-a",
          description: "Valve",
          sku: "ABC",
          aliases: [],
          ordered: 10,
          unit: "ea",
        },
      ],
    },
  ],
  linkedOrderId: "order-a",
  candidatePoolComplete: true,
  reasons: ["Unreadable quantity"],
  earlierLines: [],
};
const output = () => ({
  document: {
    kind: "delivery",
    supplierName: "Fixture",
    deliveryNumber: "SLIP-1",
    supplierOrderNumber: null,
    deliveryDate: null,
  },
  orderId: "order-a",
  orderConfidence: 0.9,
  lines: [
    {
      page: 1,
      evidence: "Valve 6 ea",
      description: "Valve",
      sku: "ABC",
      orderItemId: "item-a",
      ordered: 10,
      shipped: 6,
      backordered: 4,
      unit: "ea",
      handwritten: null,
      box: { x: 0, y: 0.2, width: 1, height: 0.1 },
      confidence: {
        part: 0.9,
        quantity: 0.8,
        match: 0.7,
        overall: 0.7,
        reason: "Fixture evidence",
      },
      issues: [],
    },
  ],
  warnings: [],
});
afterEach(() => vi.unstubAllEnvs());
describe("Terra source-bound fallback", () => {
  it("rejects foreign job/order items, hallucinated IDs and invalid source pages", () => {
    const badOrder = output();
    badOrder.orderId = "foreign-order";
    expect(() => validateFallback(badOrder, context, 1)).toThrow(/outside/);
    const badItem = output();
    badItem.lines[0]!.orderItemId = "foreign-item";
    expect(() => validateFallback(badItem, context, 1)).toThrow(/outside/);
    const badPage = output();
    badPage.lines[0]!.page = 2;
    expect(() => validateFallback(badPage, context, 1)).toThrow(/page/);
    const badBox = output();
    badBox.lines[0]!.box.width = 0.9;
    badBox.lines[0]!.box.x = 0.5;
    expect(() => validateFallback(badBox, context, 1)).toThrow(/boundary/);
  });
  it("preserves signed returns and keeps high confidence out of receipt authorization", () => {
    const raw = output();
    raw.lines[0]!.shipped = -6;
    const lines = fallbackLines(validateFallback(raw, context, 1));
    expect(lines[0]).toMatchObject({
      shipped: -6,
      proposed: null,
      quantityClear: false,
      source: "terra",
      confidenceDetails: { basis: "model_estimate", match: 0.7 },
    });
  });
  it("includes cached and output tokens and keeps absent usage unknown", () => {
    expect(terraUsage(undefined)).toBeNull();
    expect(
      terraUsage({
        input_tokens: 10000,
        output_tokens: 1000,
        input_tokens_details: { cached_tokens: 2000 },
      })?.estimatedUsd,
    ).toBeCloseTo(0.0131);
    expect(
      terraUsage({ input_tokens: 300000, output_tokens: 1000 })?.estimatedUsd,
    ).toBeCloseTo(0.6075);
  });
  it("bounds streamed response bytes before accumulating a provider body", async () => {
    await expect(
      boundedResponse(new Response("abcdefghijklmnop"), 8),
    ).rejects.toThrow(/size limit/);
  });
  it("uses strict Responses output, no storage, bounded output and no retries", async () => {
    vi.stubEnv("OPENAI_API_KEY", "fixture-server-key");
    const page = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: TERRA_MODEL,
          status: "completed",
          usage: { input_tokens: 100, output_tokens: 50 },
          output: [
            {
              type: "message",
              content: [
                { type: "output_text", text: JSON.stringify(output()) },
              ],
            },
          ],
        }),
      ),
    );
    const result = await readTerraFallback([page], context, request);
    expect(result.output.lines).toHaveLength(1);
    const body = JSON.parse(request.mock.calls[0]![1]!.body as string) as {
      input: Array<{ content: Array<{ text: string }> }>;
    };
    expect(body).toMatchObject({
      model: TERRA_MODEL,
      store: false,
      max_output_tokens: 16000,
      text: { format: { strict: true, type: "json_schema" } },
    });
    expect(body.input[0]!.content[0]!.text).not.toContain("received");
    request
      .mockReset()
      .mockResolvedValue(
        new Response("provider private body", { status: 429 }),
      );
    await expect(readTerraFallback([page], context, request)).rejects.toThrow(
      /HTTP 429/,
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
});
