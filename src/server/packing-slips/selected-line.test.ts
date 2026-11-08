import { expect, it, vi } from "vitest";
import { detectSelectedLine } from "./selected-line";
import type { ReceiptOrderItem } from "~/lib/packing-slip-review";
const read = vi.hoisted(() => vi.fn());
vi.mock("./terra-fallback", () => ({ readTerraFallback: read }));
const item: ReceiptOrderItem = { received: 0, verificationStatus: "pending", piecesPerPack: null, individualUnit: null, id: "item", description: "Cap", ordered: 2, unit: "ea", aliases: [], sku: null };
const box = { x: .4, y: .5, width: .2, height: .05 };
it("requests one full-width row with headings and ignores header detections", async () => {
  const line = { page: 2, box, description: "Cap" };
  read.mockResolvedValue({ output: { lines: [{ page: 2, box: { ...box, y: .1 } }, line] } });
  const result = await detectSelectedLine([Buffer.from("one"), Buffer.from("two")], 2, box, "order", item);
  expect(result.line).toEqual(line);
  expect(read.mock.calls.at(-1)![1]).toMatchObject({ targetLineIndexes: [0], earlierLines: [{ page: 2, box: { x: 0, width: 1, y: .5, height: .05 } }] });
});
it("requires one unambiguous detected row", async () => {
  read.mockResolvedValue({ output: { lines: [] } });
  await expect(detectSelectedLine([Buffer.from("one")], 1, box, "order", item)).rejects.toThrow("No line");
  read.mockResolvedValue({ output: { lines: [{ page: 1, box }, { page: 1, box }] } });
  await expect(detectSelectedLine([Buffer.from("one")], 1, box, "order", item)).rejects.toThrow("More than one");
});
