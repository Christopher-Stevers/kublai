// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ReceiptOrderItem } from "~/lib/packing-slip-review";
import {
  askWhichOrder,
  findOrder,
  supplierNamed,
  suggestedOrder,
  type SlipOrder,
} from "./find-order";

const item = (
  id: string,
  description: string,
  sku: string | null = null,
  received = 0,
) =>
  ({
    id,
    description,
    sku,
    aliases: [],
    ordered: 10,
    received,
    verificationStatus: "pending",
    unit: "ea",
    piecesPerPack: null,
    individualUnit: null,
  }) as unknown as ReceiptOrderItem;
const order = (
  id: string,
  supplier: string | null,
  items: ReceiptOrderItem[],
  orderNumber = `${id}-${supplier}`,
): SlipOrder => ({
  id,
  orderNumber,
  supplier,
  items,
});
const rows = (...text: string[]) => text.map((t) => ({ page: 1, text: t }));

const fasteners = order("174", "Fastening House", [
  item("a", "Hex lag screw 3/8 x 3 zinc", "LAG383"),
  item("b", "Concrete wedge anchor 1/2 x 4", "WA124"),
  item("c", "Fender washer 3/8 zinc", "FW38"),
]);
const pipe = order("175", "Next", [
  item("d", "Copper pipe type L 3/4 x 12 ft", "CUL34"),
  item("e", "Copper elbow 90 3/4 wrot", "CE9034"),
  item("f", "Ball valve 3/4 sweat lead free", "BV34"),
]);

describe("supplierNamed", () => {
  it("needs the full or a distinctive name", () => {
    expect(
      supplierNamed("Fastening House", "FASTENING HOUSE LTD\nPacking slip"),
    ).toBe(1);
    expect(supplierNamed("Fastening House", "the house of pipe")).toBe(0.4);
    expect(supplierNamed("Next", "Ships NEXT DAY")).toBe(0.4);
    expect(supplierNamed("Emco Supply", "EMCO Corporation")).toBe(0.4);
    expect(supplierNamed(null, "anything")).toBe(0);
  });
});

describe("findOrder", () => {
  it("matches the slip on its products, not a common supplier word", () => {
    const { ranked, confident } = findOrder(
      rows(
        "FASTENING HOUSE LTD   SHIP NEXT DAY",
        "LAG383 HEX LAG SCREW 3/8 X 3 ZINC 10",
        "WA124 WEDGE ANCHOR 1/2 X 4 10",
        "FW38 FENDER WASHER 3/8 ZN 10",
      ),
      [pipe, fasteners],
    );
    expect(confident).toBe(true);
    expect(ranked[0]).toMatchObject({
      orderId: "174",
      found: 3,
      supplier: true,
    });
  });

  it("tells apart two orders from the same supplier by their products", () => {
    const second = order("176", "Fastening House", [
      item("g", "Threaded rod 3/8 x 10 ft zinc", "TR3810"),
      item("h", "Hex nut 3/8 zinc", "HN38"),
    ]);
    const { ranked, confident } = findOrder(
      rows(
        "FASTENING HOUSE",
        "TR3810 THREADED ROD 3/8 X 10FT ZINC 10",
        "HN38 HEX NUT 3/8 ZINC 100",
      ),
      [fasteners, second],
    );
    expect(ranked[0]!.orderId).toBe("176");
    expect(confident).toBe(true);
  });

  it("is not confident when the slip fits two orders equally", () => {
    const twin = order(
      "177",
      "Fastening House",
      fasteners.items.map((i) => ({ ...i, id: `${i.id}2` })),
    );
    const { ranked, confident } = findOrder(
      rows(
        "LAG383 HEX LAG SCREW 3/8 X 3 ZINC 10",
        "WA124 WEDGE ANCHOR 1/2 X 4 10",
      ),
      [fasteners, twin],
    );
    expect(ranked).toHaveLength(2);
    expect(confident).toBe(false);
  });

  it("prefers the order still waiting for its delivery", () => {
    const delivered = order(
      "170",
      "Fastening House",
      fasteners.items.map((i) => ({
        ...i,
        id: `${i.id}0`,
        received: i.ordered,
      })),
    );
    const { ranked } = findOrder(
      rows(
        "LAG383 HEX LAG SCREW 3/8 X 3 ZINC 10",
        "WA124 WEDGE ANCHOR 1/2 X 4 10",
        "FW38 FENDER WASHER 3/8 ZN 10",
      ),
      [delivered, fasteners],
    );
    expect(ranked[0]!.orderId).toBe("174");
  });

  it("is not confident about an unrelated slip", () => {
    const { confident } = findOrder(
      rows("PAINT ROLLER 9 IN", "DROP CLOTH CANVAS"),
      [fasteners, pipe],
    );
    expect(confident).toBe(false);
  });
});

describe("askWhichOrder", () => {
  it("maps Jev's choice back to an order", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64",
    );
    let asked = "";
    const answer = await askWhichOrder(
      [png, png],
      [fasteners, pipe],
      async (inputs, questions) => {
        asked = String(inputs.orders);
        expect(inputs).toHaveProperty("slip_page_2");
        expect(asked).toContain("ordered 10 ea");
        expect(
          Object.keys((questions.order as { criteria: object }).criteria),
        ).toEqual(["o1", "o2", "none"]);
        return {
          order: {
            type: "choice",
            choice: "o2",
            confidence: 0.6,
            probabilities: { o2: 0.9 },
          },
        };
      },
    );
    expect(asked).toContain(
      "Order 2: supplier Next; products: CUL34 Copper pipe",
    );
    expect(answer).toEqual({ orderId: "175", confidence: 0.9 });
  });
});

it("suggests overlapping products without requiring automatic-match certainty", () => {
  const result = findOrder(
    rows("Next", "CUL34 Copper pipe type L 3/4 x 12 ft"),
    [pipe, fasteners],
  );
  expect(result.confident).toBe(false);
  expect(suggestedOrder(result.ranked)).toBe(pipe.id);
  expect(
    suggestedOrder(findOrder(rows("Next", "UNRELATED PAINT"), [pipe]).ranked),
  ).toBeNull();
});

it("uses only ordered quantity cells to distinguish otherwise identical products", () => {
  const row = (y: number, cells: Array<[string, number]>) => ({
    page: 1,
    text: cells.map((c) => c[0]).join(" "),
    words: cells.map(([text, x]) => ({
      text,
      x,
      y,
      width: 0.04,
      height: 0.012,
      confidence: 95,
    })),
  });
  const slip = [
    row(0.2, [
      ["Description", 0.1],
      ["Ordered", 0.5],
      ["Shipped", 0.7],
      ["Unit", 0.85],
    ]),
    row(0.25, [
      ["CUL34", 0.1],
      ["4.00", 0.5],
      ["2.00", 0.7],
      ["EA", 0.85],
    ]),
  ];
  const four = order("four", "Next", [{ ...pipe.items[0]!, ordered: 4 }]);
  const two = order("two", "Next", [{ ...pipe.items[0]!, ordered: 2 }]);
  const result = findOrder(slip, [two, four]);
  expect(result.ranked[0]).toMatchObject({
    orderId: "four",
    quantityMatches: 1,
  });
  expect(result.ranked[1]).toMatchObject({
    orderId: "two",
    quantityMatches: 0,
  });
});
