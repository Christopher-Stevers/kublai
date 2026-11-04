import { describe, expect, it } from "vitest";
import type { ReceiptOrderItem } from "~/lib/packing-slip-review";
import {
  matchConfidence,
  sameSupplier,
  type CandidateOrder,
  type SlipEvidence,
} from "./match-confidence";

const PRODUCTS = [
  ["C9012", "Copper 90 elbow 1/2 wrot"],
  ["CT34", "Copper tee 3/4 wrot"],
  ["BV12", "Ball valve 1/2 full port sweat"],
  ["PX12100", "PEX tubing 1/2 coil 100 ft"],
  ["CC34", "Copper coupling 3/4 with stop"],
  ["CPL12", "Copper pipe type L 1/2 x 12 ft"],
  ["CH34", "Clevis hanger 3/4 galvanized"],
  ["TT12", "Thread seal tape 1/2 x 260"],
  ["AAV15", "Air admittance valve 1-1/2"],
  ["ABS3045", "ABS 45 elbow 3 inch"],
  ["SH4", "Shower drain 4 inch brass"],
  ["GV34", "Gate valve 3/4 bronze threaded"],
] as const;
const item = (
  id: string,
  k: number,
  ordered: number,
  received: number,
): ReceiptOrderItem => ({
  id,
  description: PRODUCTS[k]![1],
  sku: PRODUCTS[k]![0],
  aliases: [],
  ordered,
  received,
  verificationStatus: "pending",
  unit: "ea",
  piecesPerPack: null,
  individualUnit: null,
});
const order = (
  id: string,
  products: number[],
  sentAt: string | null,
  { supplier = "Next", ordered = 10, received = 0 } = {},
): CandidateOrder => ({
  id,
  orderNumber: `${id}-${supplier}`,
  supplier,
  sentAt,
  items: products.map((k) => item(`${id}:${k}`, k, ordered, received)),
});
const slip = (
  products: number[],
  more: Partial<SlipEvidence> = {},
  ordered: number | null = 10,
): SlipEvidence => ({
  lines: products.map((k) => ({
    page: 1,
    sku: PRODUCTS[k]![0],
    description: PRODUCTS[k]![1].toUpperCase(),
    evidence: "",
    ordered,
    unit: "EA",
  })),
  supplier: "NEXT PLUMBING & HEATING SUPPLY",
  ...more,
});
const ALL = [0, 1, 2, 3, 4, 5, 6, 7];
const of = (ranked: ReturnType<typeof matchConfidence>, id: string) =>
  ranked.find((r) => r.orderId === id)!;

describe("matchConfidence", () => {
  // Tim's slip: one Next order fits, four other Next orders share some of
  // its products and were all sent after the slip was printed.
  const lookalikes = [
    order("165", [0, 1, 2, 8, 9], "2026-10-21T16:00:00Z"),
    order("137", [0, 1, 2, 3, 4, 10, 11], "2026-10-01T16:00:00Z"),
    order("67", [3, 4, 5, 8], "2026-06-25T16:00:00Z"),
    order("61", [5, 6, 7, 9], "2026-06-25T16:00:00Z"),
  ];
  const right = order("36", ALL, "2026-06-03T16:00:00Z");

  it("is sure of the order a slip fits, however many lookalikes the job has", () => {
    const ranked = matchConfidence(slip(ALL, { date: "2026-06-04" }), [
      ...lookalikes,
      right,
    ]);
    expect(ranked[0]).toMatchObject({ orderId: "36", found: 8 });
    expect(ranked[0]!.confidence).toBeGreaterThanOrEqual(95);
    expect(ranked[0]!.notes).toContain("Sent 1 day before the slip");
    for (const rival of ranked.slice(1))
      expect(rival.confidence).toBeLessThan(2);
    expect(of(ranked, "137").notes.join()).toMatch(/after the slip date/);
  });

  it("is sure from the products alone when rivals leave slip lines unexplained", () => {
    const ranked = matchConfidence(slip(ALL, { supplier: null }, null), [
      ...lookalikes,
      right,
    ]);
    expect(ranked[0]!.orderId).toBe("36");
    expect(ranked[0]!.confidence).toBeGreaterThanOrEqual(90);
    expect(of(ranked, "137").notes).toContain("3 slip lines not on this order");
  });

  it("stays unsure between two orders the slip fits equally", () => {
    const ranked = matchConfidence(slip(ALL), [
      order("a", ALL, null),
      order("b", ALL, null),
    ]);
    expect(Math.max(...ranked.map((r) => r.confidence))).toBeLessThan(90);
    expect(
      Math.abs(ranked[0]!.confidence - ranked[1]!.confidence),
    ).toBeLessThanOrEqual(1);
  });

  it("lets the slip date tell a fresh order from one already received", () => {
    const ranked = matchConfidence(slip(ALL, { date: "2026-06-04" }), [
      order("old", ALL, "2026-02-03T16:00:00Z", { received: 10 }),
      order("new", ALL, "2026-06-02T16:00:00Z"),
    ]);
    expect(ranked[0]!.orderId).toBe("new");
    expect(ranked[0]!.confidence).toBeGreaterThanOrEqual(90);
    expect(of(ranked, "old").notes).toContain("Already fully received");
  });

  it("lets printed ordered quantities tell a reorder from the first order", () => {
    const ranked = matchConfidence(slip(ALL, {}, 25), [
      order("first", ALL, null),
      order("reorder", ALL, null, { ordered: 25 }),
    ]);
    expect(ranked[0]!.orderId).toBe("reorder");
    expect(ranked[0]!.confidence).toBeGreaterThanOrEqual(90);
    expect(ranked[0]!.notes).toContain("8 ordered quantities agree");
  });

  it("does not let one product make an order sure", () => {
    const [only] = matchConfidence(slip([2], { date: "2026-06-04" }, null), [
      order("o", [2, 8, 9], "2026-06-03T16:00:00Z"),
    ]);
    expect(only!.found).toBe(1);
    expect(only!.confidence).toBeLessThan(90);
  });

  it("doubts an order sent well after the slip was printed", () => {
    const sent = (date: string) =>
      matchConfidence(slip([0, 1, 2], { date: "2026-06-04" }, null), [
        order("o", [0, 1, 2], date),
      ])[0]!;
    expect(sent("2026-06-02T16:00:00Z").confidence).toBeGreaterThanOrEqual(90);
    const late = sent("2026-06-24T16:00:00Z");
    expect(late.confidence).toBeLessThan(50);
    expect(late.notes).toContain("Sent 20 days after the slip date");
  });

  it("doubts an order whose supplier the slip does not name", () => {
    const ranked = matchConfidence(slip(ALL, { supplier: "EMCO LIMITED" }), [
      order("next", ALL, null),
      order("emco", ALL, null, { supplier: "Emco" }),
    ]);
    expect(ranked[0]!.orderId).toBe("emco");
    expect(ranked[0]!.confidence).toBeGreaterThanOrEqual(90);
    expect(of(ranked, "next").notes).toContain(
      "The slip names another supplier",
    );
  });

  it("counts our order number printed on the slip", () => {
    const ranked = matchConfidence(
      slip(ALL, { text: "CUSTOMER PO: 36-NEXT" }),
      [order("35", ALL, null), order("36", ALL, null)],
    );
    expect(ranked[0]!.orderId).toBe("36");
    expect(ranked[0]!.confidence).toBeGreaterThanOrEqual(90);
    expect(ranked[0]!.notes).toContain("Our order number is on the slip");
  });

  it("counts a supplier order number only one earlier order's slips share", () => {
    const twins = [order("a", ALL, null), order("b", ALL, null)];
    const ranked = matchConfidence(
      slip(ALL, {
        numbers: ["SO-55120"],
        earlier: [{ orderId: "b", numbers: ["SO 55120", "PS-1"] }],
      }),
      twins,
    );
    expect(ranked[0]!.orderId).toBe("b");
    expect(ranked[0]!.confidence).toBeGreaterThanOrEqual(90);
    expect(ranked[0]!.notes).toContain(
      "Same supplier order as an earlier slip",
    );
    // A number on slips of two orders, such as a job number, says nothing.
    const job = matchConfidence(
      slip(ALL, {
        numbers: ["J2041"],
        earlier: [
          { orderId: "a", numbers: ["J2041"] },
          { orderId: "b", numbers: ["J2041"] },
        ],
      }),
      twins,
    );
    expect(Math.max(...job.map((r) => r.confidence))).toBeLessThan(90);
  });

  it("does not hold this slip's own receipt against its order", () => {
    const open = matchConfidence(slip(ALL), [order("o", ALL, null)]);
    const done = matchConfidence(
      {
        ...slip(ALL),
        received: Object.fromEntries(ALL.map((k) => [`o:${k}`, 10])),
      },
      [order("o", ALL, null, { received: 10 })],
    );
    expect(done[0]!.confidence).toBe(open[0]!.confidence);
    expect(done[0]!.notes).not.toContain("Already fully received");
  });

  it("knows a supplier from the name its slip prints", () => {
    expect(sameSupplier("Next", "NEXT PLUMBING & HEATING")).toBe(true);
    expect(sameSupplier("Fastening House", "FASTENING HOUSE INC")).toBe(true);
    expect(sameSupplier("Pacific Pipe & Valve", "Pacific Mechanical")).toBe(
      false,
    );
    expect(sameSupplier("Emco", "EMCO LIMITED")).toBe(true);
  });
});
