// @vitest-environment node
import sharp from "sharp";
import { beforeAll, expect, it, vi } from "vitest";
import { analyzeSlip, type Evaluator } from "./analyze";
import { bandsFromTable, type VisionAnswer, type VisionAsk } from "./vision";
import type { ReceiptOrderItem, SlipLine } from "~/lib/packing-slip-review";
import type { SlipRow } from "./ocr-rows";

const item: ReceiptOrderItem = {
  id: "a",
  description: "Brass valve",
  sku: "ABC123",
  aliases: [],
  ordered: 10,
  received: 2,
  verificationStatus: "partial",
  unit: "ea",
  piecesPerPack: null,
  individualUnit: null,
};
function row(texts: string[], y: number): SlipRow {
  return {
    page: 1,
    text: texts.join(" "),
    words: texts.map((text, i) => ({
      text,
      x: [0.05, 0.2, 0.6, 0.7, 0.8, 0.9][i]!,
      y,
      width: 0.04,
      height: 0.02,
      confidence: 98,
    })),
  };
}
const header = row(
  ["SKU", "Description", "Ordered", "Shipped", "Backordered", "Unit"],
  0.1,
);
const line = row(["ABC123", "Brass valve", "10", "6", "4", "ea"], 0.2);
const noAssistant: Evaluator = async () => {
  throw Error("The text assistant should not be used.");
};
let page: Buffer;
beforeAll(async () => {
  page = await sharp({
    create: { width: 1000, height: 1400, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
});

type ChoiceAnswer = Extract<VisionAnswer, { type: "choice" }>;
const pick = (choice: string, confidence = 0.9): ChoiceAnswer => ({
  type: "choice",
  choice,
  confidence,
});
const box = (left: number, right: number, top = 0.09, bottom = 0.12) => ({
  type: "box" as const,
  box: { top, bottom, left, right },
  confidence: 0.9,
});
type Answers = Record<string, VisionAnswer>;
/** A fake Jev: each call is recognised by its questions; `set` overrides answers. */
function fakeJev(set: {
  page?: Answers;
  total?: VisionAnswer;
  rows?: Answers;
  main?: Answers;
  cells?: Answers;
  views?: VisionAnswer;
}) {
  const calls: string[] = [];
  const ask: VisionAsk = async (_inputs, questions) => {
    const ids = Object.keys(questions);
    const only = (answers: Answers) =>
      Object.fromEntries(ids.map((id) => [id, answers[id]!]));
    if (ids.includes("header")) {
      calls.push("page");
      return only({
        header: box(0, 1),
        shipped: box(0.68, 0.74),
        ordered: box(0.58, 0.64),
        backordered: box(0.78, 0.86),
        product: box(0.03, 0.4, 0.09, 0.5),
        lines: pick("n1", 0.95),
        range: pick("r0", 0.99),
        count: pick("n0", 0.95),
        ...set.page,
      });
    }
    if (ids.includes("total")) {
      calls.push("total");
      return { total: set.total ?? pick("v6", 0.99) };
    }
    if (ids.includes("row1")) {
      calls.push("rows");
      return only(set.rows ?? {});
    }
    if (ids.includes("kind")) {
      calls.push("main");
      return only({
        kind: pick("one", 0.99),
        part: { ...pick("item0", 0.95), probabilities: { item0: 0.95 } },
        shipped: pick("v6"),
        backordered: pick("v4"),
        ordered: pick("v10"),
        unit: pick("ea"),
        handwriting: pick("no"),
        ...set.main,
      });
    }
    if (ids.includes("shipped")) {
      calls.push("cells");
      return only({
        shipped: pick("v6"),
        ordered: pick("v10"),
        backordered: pick("v4"),
        ...set.cells,
      });
    }
    calls.push("view");
    return { part: set.views ?? pick("item0", 0.95) };
  };
  return { ask, calls };
}
const analyze = (
  rows: SlipRow[],
  ask: VisionAsk,
  items = [item],
  pages = [page],
) => analyzeSlip(rows, items, noAssistant, { pages, ask });

it("prefills a line when every reading is confident and fits the order", async () => {
  const jev = fakeJev({});
  const result = await analyze([header, line], jev.ask);
  expect(result.model).toBe("jev-1.14.0 (images)");
  expect(result.warnings).toEqual([]);
  expect(result.lines).toHaveLength(1);
  expect(result.lines[0]).toMatchObject({
    orderItemId: "a",
    shipped: 6,
    backordered: 4,
    ordered: 10,
    unit: "ea",
    proposed: 6,
    issues: [],
    quantityClear: true,
    confidence: "high",
    source: "vision",
  });
  // Page, exact total, then four views of the one line.
  expect(jev.calls.sort()).toEqual(
    ["cells", "main", "page", "total", "view", "view"].sort(),
  );
});

it("blocks a product whose printed order quantity does not fit the order item", async () => {
  const jev = fakeJev({
    main: { ordered: pick("v7"), backordered: pick("v1") },
    cells: { ordered: pick("v7"), backordered: pick("v1") },
  });
  const [read] = (await analyze([header, line], jev.ask)).lines;
  expect(read!.proposed).toBeNull();
  expect(read!.issues).toEqual([
    "Check the product: the slip shows 7 ordered; the order has 10 ea.",
  ]);
  // Only the product is in doubt: linking it settles the line.
  expect(read!.quantityClear).toBe(true);
});

it("blocks lines that match the same order item", async () => {
  const other = row(["ABC124", "Brass valve", "10", "6", "4", "ea"], 0.3);
  const jev = fakeJev({
    page: { lines: pick("n2", 0.95) },
    total: pick("v12"),
  });
  const { lines } = await analyze([header, line, other], jev.ask);
  expect(lines).toHaveLength(2);
  for (const l of lines) {
    expect(l.proposed).toBeNull();
    expect(l.issues).toContain(
      "Check the product: several slip lines match this order item.",
    );
  }
});

it("blocks shipping more than is still due", async () => {
  const jev = fakeJev({});
  const [read] = (
    await analyze([header, line], jev.ask, [{ ...item, received: 5 }])
  ).lines;
  expect(read!.proposed).toBeNull();
  expect(read!.issues).toContain("Ships 6 ea, more than the 5 ea still due.");
});

it("blocks every line when the printed totals disagree", async () => {
  const jev = fakeJev({ total: pick("v7") });
  const result = await analyze([header, line], jev.ask);
  expect(result.warnings).toEqual([
    "Check every line: the slip's total shipped is 7 but the lines add up to 6.",
  ]);
  expect(result.lines[0]).toMatchObject({
    proposed: null,
    quantityClear: false,
    issues: ["The slip's printed totals do not match the lines read."],
  });
  const count = fakeJev({ page: { lines: pick("n3", 0.95) } });
  expect((await analyze([header, line], count.ask)).warnings).toEqual([
    "Check every line: the slip lists 3 lines but 1 were read.",
  ]);
  // An unsure total reading is not trusted either way.
  const unsure = fakeJev({ total: pick("v7", 0.4) });
  expect((await analyze([header, line], unsure.ask)).lines[0]!.proposed).toBe(
    6,
  );
});

it("prefers the enlarged cell but blocks when it disagrees with the line", async () => {
  const jev = fakeJev({ cells: { shipped: pick("v8", 0.95) } });
  const [read] = (await analyze([header, line], jev.ask)).lines;
  expect(read!.shipped).toBe(8);
  expect(read!.proposed).toBeNull();
  expect(read!.issues).toContain(
    "Shipped reads as 6 on the line and 8 in the cell. Check the slip.",
  );
  expect(read!.issues).toContain(
    "Ordered 10, shipped 8 and backordered 4 do not add up. Check the slip.",
  );
});

it("raises confidence when the line and cell agree and balance", async () => {
  // 78% twice is too unsure alone; read twice and balanced it is not.
  const jev = fakeJev({
    main: { shipped: pick("v6", 0.78), backordered: pick("v4", 0.7) },
    cells: { shipped: pick("v6", 0.78), backordered: pick("v4", 0.7) },
  });
  const [read] = (await analyze([header, line], jev.ask)).lines;
  expect(read!.proposed).toBe(6);
  const unbalanced = fakeJev({
    main: { shipped: pick("v6", 0.78), ordered: pick("v12") },
    cells: { shipped: pick("v6", 0.78), ordered: pick("v12") },
  });
  const [blocked] = (await analyze([header, line], unbalanced.ask)).lines;
  expect(blocked!.proposed).toBeNull();
  expect(blocked!.issues).toContain(
    "Check shipped quantity against the slip; the print is unclear.",
  );
});

it("averages the three product views", async () => {
  // The row view alone is sure; the other two views doubt it.
  const doubt = {
    ...pick("not_on_order", 0.7),
    probabilities: { item0: 0.3, not_on_order: 0.7 },
  };
  const jev = fakeJev({ views: doubt });
  const [read] = (await analyze([header, line], jev.ask)).lines;
  // (0.95 + 0.3 + 0.3) / 3 = 0.52 for the item; 0.47 against.
  expect(read!.orderItemId).toBe("a");
  expect(read!.confidence).toBe("low");
  expect(read!.issues).toEqual([
    "Check the product: only 52% sure it is this order item.",
  ]);
  const notOrdered = fakeJev({
    main: {
      part: {
        ...pick("not_on_order", 0.8),
        probabilities: { item0: 0.2, not_on_order: 0.8 },
      },
    },
    views: doubt,
  });
  const [other] = (await analyze([header, line], notOrdered.ask)).lines;
  expect(other).toMatchObject({
    orderItemId: null,
    proposed: null,
    candidates: ["a"],
  });
});

it("finds lines on pages without a readable table and ends each where the next starts", async () => {
  const jev = fakeJev({
    page: {
      count: pick("n2", 0.95),
      lines: pick("n2", 0.95),
      range: pick("r0", 0.99),
    },
    total: pick("v12"),
    rows: {
      row1: box(0, 1, 0.2, 0.32),
      row2: box(0, 1, 0.28, 0.36),
    },
    // Two lines need two products.
    main: {
      part: { ...pick("item0", 0.95), probabilities: { item0: 0.95 } },
    },
  });
  const loose = [
    row(["Brass", "valve", "6"], 0.21),
    row(["Steel", "pipe", "6"], 0.29),
  ];
  const { lines } = await analyze(loose, jev.ask);
  const edges = lines.map((l) => [l.box!.y, l.box!.y + l.box!.height]);
  for (const [k, value] of [0.2, 0.28, 0.28, 0.36].entries())
    expect(edges.flat()[k]).toBeCloseTo(value);
  expect(lines.map((l) => l.evidence)).toEqual([
    "Brass valve 6",
    "Steel pipe 6",
  ]);
});

it("falls back to the text reading when the images cannot be read", async () => {
  const failing: VisionAsk = async () => {
    throw Error("Image reading is temporarily unavailable.");
  };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const result = await analyze([header, line], failing);
    expect(result.model).toBe("table reader");
    expect(result.warnings).toContain(
      "The slip images could not be checked; lines were read from text only.",
    );
    expect(result.lines[0]).toMatchObject({ orderItemId: "a", shipped: 6 });
    // Missing page images are a failure too, not a partial reading.
    const partial = await analyze(
      [header, { ...line, page: 2 }],
      fakeJev({}).ask,
    );
    expect(partial.model).toBe("table reader");
  } finally {
    warn.mockRestore();
  }
});

it("joins table lines split mid-item back together", () => {
  const at = (evidence: string, y: number): SlipLine => ({
    page: 1,
    evidence,
    orderItemId: null,
    shipped: null,
    backordered: null,
    unit: null,
    proposed: null,
    issues: [],
    box: { x: 0, y, width: 1, height: 0.02 },
  });
  const bands = bandsFromTable([
    at("| 1 ABC123 Brass valve 10 6", 0.2),
    at("with handle", 0.23),
    at("2 XYZ 4", 0.26),
  ]);
  expect(bands).toHaveLength(2);
  expect(bands[0]).toMatchObject({
    top: 0.2,
    bottom: 0.256,
    evidence: "| 1 ABC123 Brass valve 10 6 / with handle",
  });
  expect(bands[1]!.bottom).toBeCloseTo(0.31);
});
