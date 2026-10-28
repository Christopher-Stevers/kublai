// @vitest-environment node
import { afterAll, describe, expect, it, vi } from "vitest";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
const { root } = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os");
  return { root: await mkdtemp(`${tmpdir()}/slip-record-test-`) };
});
vi.mock("~/server/documents/storage", () => ({ documentStorageRoot: root }));
import {
  detectionInputSchema,
  blindItems,
  detectionRoot,
  digest,
  evidenceLines,
  immutableJson,
} from "./detection-record";
import {
  captureDetectionInput,
  recordPipelineStage,
  withSlipTrace,
} from "./trace";
import type { ReceiptOrderItem, SlipLine } from "~/lib/packing-slip-review";
const org = "11111111-1111-4111-8111-111111111111",
  job = "22222222-2222-4222-8222-222222222222",
  run = "33333333-3333-4333-8333-333333333333";
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
describe("replay evidence", () => {
  it("strips receipt outcomes and preserves original ordered quantity and pack units", () => {
    const item = {
      id: run,
      description: "Washer",
      sku: "W123",
      aliases: [],
      ordered: 7,
      originalOrdered: 10,
      received: 6,
      returned: 2,
      credited: 3,
      verificationStatus: "verified",
      unit: "box",
      piecesPerPack: 50,
      individualUnit: "ea",
    } satisfies ReceiptOrderItem;
    const [copy] = blindItems([item]);
    expect(copy).toMatchObject({ ordered: 10, unit: "box", piecesPerPack: 50 });
    expect(copy).not.toHaveProperty("received");
    expect(copy).not.toHaveProperty("credited");
    expect(copy).not.toHaveProperty("verificationStatus");
  });
  it("saves cheap-only inputs, retains separate retries and never overwrites immutable predictions", async () => {
    for (let n = 0; n < 2; n++)
      await withSlipTrace(org, run, async () => {
        await captureDetectionInput(
          {
            organizationId: org,
            jobId: job,
            documentId: org,
            versionId: job,
            source: {
              sha256: digest("source"),
              mimeType: "application/pdf",
              name: "source.pdf",
            },
            sourceWarnings: [],
            candidatePoolComplete: true,
            orders: [],
            provenance: "captured-before-reading",
          },
          [Buffer.from("page")],
        );
        await recordPipelineStage("final-reading", {
          lines: [],
          cascade: { status: "not-needed" },
        });
      });
    const runFolder = path.join(detectionRoot(org, job), run),
      attempts = await readdir(runFolder);
    expect(attempts).toHaveLength(2);
    const input = detectionInputSchema.parse(
      JSON.parse(
        await readFile(
          path.join(runFolder, attempts[0]!, "input.json"),
          "utf8",
        ),
      ),
    );
    const result: unknown = JSON.parse(
      await readFile(path.join(runFolder, attempts[0]!, "result.json"), "utf8"),
    );
    expect(result).toMatchObject({
      inputSha256: digest(JSON.stringify(input)),
      modelCalls: [],
      status: "completed",
    });
    expect(input.pages).toEqual([{ page: 1, sha256: digest("page") }]);
    await expect(
      immutableJson(path.join(runFolder, attempts[0]!, "result.json"), {
        changed: true,
      }),
    ).rejects.toThrow();
    expect(
      JSON.parse(
        await readFile(
          path.join(runFolder, attempts[0]!, "result.json"),
          "utf8",
        ),
      ),
    ).toEqual(result);
  });
  it("aligns source evidence independently of predictions and distinguishes identical repeated rows", () => {
    const line: SlipLine = {
      page: 1,
      evidence: "CODE 6",
      box: { x: 0.1, y: 0.2, width: 0.7, height: 0.02 },
      orderItemId: null,
      shipped: null,
      backordered: null,
      unit: null,
      proposed: null,
      issues: [],
    };
    const a = evidenceLines([line, line], digest("source"));
    const b = evidenceLines(
      [{ ...line, orderItemId: run, shipped: 6 }],
      digest("source"),
    );
    expect(a[0]!.sourceLineId).toBe(b[0]!.sourceLineId);
    expect(a[0]!.sourceLineId).not.toBe(a[1]!.sourceLineId);
    expect(b[0]!.confidenceCalibrated).toBe(false);
  });
});
