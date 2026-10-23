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
  pageItems?: Answers;
  hand?: VisionAnswer;
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
    if (ids.includes("handwritten")) {
      calls.push("handwritten");
      return { handwritten: set.hand ?? pick("none") };
    }
    if (ids.every((id) => /^item\d+$/.test(id))) {
      calls.push("items");
      return only({
        ...Object.fromEntries(ids.map((id) => [id, pick("unclear")])),
        ...set.pageItems,
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
  memory?: { known: Record<string, string[]>; expectFooter: boolean },
) => analyzeSlip(rows, items, noAssistant, { pages, ask, memory });
/** The same item without a SKU, so no printed code settles the product. */
const uncoded = { ...item, sku: null };

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
  expect(result.lines[0]!.notes).toContain(
    "Matched by the order's SKU ABC123.",
  );
  // Page, exact total, then the line and its cells. The printed SKU settles
  // the product, so no extra product views.
  expect(jev.calls.sort()).toEqual(["cells", "main", "page", "total"].sort());
  // Without a code, a sure first answer also skips the extra views...
  const sure = fakeJev({});
  await analyze([header, line], sure.ask, [uncoded]);
  expect(sure.calls).not.toContain("view");
  // ...and an unsure one asks for them.
  const unsure = fakeJev({
    main: { part: { ...pick("item0", 0.85), probabilities: { item0: 0.85 } } },
  });
  await analyze([header, line], unsure.ask, [uncoded]);
  expect(unsure.calls.filter((c) => c === "view")).toHaveLength(2);
});

it("lets a printed code decide the product unless the image clearly disagrees", async () => {
  const other = { ...item, id: "b", sku: "XYZ999", description: "Steel pipe" };
  // Jev leans to the other item, but not surely: the code wins.
  const leaning = fakeJev({
    main: {
      part: {
        ...pick("item1", 0.6),
        probabilities: { item0: 0.4, item1: 0.6 },
      },
    },
    views: { ...pick("item1", 0.6), probabilities: { item0: 0.4, item1: 0.6 } },
  });
  const [coded] = (await analyze([header, line], leaning.ask, [item, other]))
    .lines;
  expect(coded).toMatchObject({ orderItemId: "a", proposed: 6 });
  // Sure it is the other item: flagged instead.
  const sure = fakeJev({
    main: {
      part: {
        ...pick("item1", 0.9),
        probabilities: { item0: 0.1, item1: 0.9 },
      },
    },
    views: { ...pick("item1", 0.9), probabilities: { item0: 0.1, item1: 0.9 } },
  });
  const [flagged] = (await analyze([header, line], sure.ask, [item, other]))
    .lines;
  expect(flagged!.proposed).toBeNull();
  expect(flagged!.issues).toContain(
    "Check the product: code ABC123 belongs to another order item, but the line looks like a different product.",
  );
});

it("uses supplier codes confirmed on earlier deliveries", async () => {
  const learnedLine = row(["SUP-4471", "Valve", "10", "6", "4", "ea"], 0.2);
  const unsure = fakeJev({
    main: { part: { ...pick("item0", 0.6), probabilities: { item0: 0.6 } } },
    views: { ...pick("item0", 0.6), probabilities: { item0: 0.6 } },
  });
  const [read] = (
    await analyze([header, learnedLine], unsure.ask, [uncoded], [page], {
      known: { a: ["SUP4471"] },
      expectFooter: false,
    })
  ).lines;
  expect(read).toMatchObject({ orderItemId: "a", proposed: 6 });
  expect(read!.notes).toContain(
    "Matched by supplier code SUP4471, confirmed on an earlier delivery.",
  );
});

it("offers a handwritten quantity without prefilling it", async () => {
  const jev = fakeJev({
    main: { handwriting: pick("yes") },
    hand: pick("v5", 0.9),
  });
  const [read] = (await analyze([header, line], jev.ask)).lines;
  expect(read!.handwritten).toBe(5);
  expect(read!.proposed).toBeNull();
  expect(read!.issues).toContain(
    "Handwriting on this line may change the quantity. Check the slip.",
  );
  // No handwriting: not asked.
  const plain = fakeJev({});
  await analyze([header, line], plain.ask);
  expect(plain.calls).not.toContain("handwritten");
});

it("accepts pen marks that agree with a printed count that adds up", async () => {
  // A tick beside the printed 6, read as a written 6.
  const ticked = fakeJev({
    main: { handwriting: pick("unclear") },
    hand: pick("v6", 0.9),
  });
  const [read] = (await analyze([header, line], ticked.ask)).lines;
  expect(ticked.calls).toContain("handwritten");
  expect(read).toMatchObject({ proposed: 6, issues: [] });
  expect(read!.notes).toContain(
    "Pen marks on this line agree with the printed 6.",
  );
  // When the line does not add up, the pen may be what does not fit.
  const unbalanced = fakeJev({
    main: { handwriting: pick("yes"), ordered: pick("v13") },
    cells: { ordered: pick("v13") },
    hand: pick("v6", 0.9),
  });
  expect(
    (await analyze([header, line], unbalanced.ask)).lines[0]!.issues,
  ).toContain(
    "Handwriting on this line may change the quantity. Check the slip.",
  );
});

it("counts earlier deliveries in the slip's ordered quantity", async () => {
  // Ordered 10: 2 received before, 6 now and 2 still to come.
  const second = {
    main: { backordered: pick("v2") },
    cells: { backordered: pick("v2") },
  };
  const [read] = (await analyze([header, line], fakeJev(second).ask)).lines;
  expect(read).toMatchObject({ proposed: 6, issues: [] });
  expect(read!.notes).toContain(
    "The slip's ordered quantity includes the 2 ea received earlier.",
  );
  const [first] = (
    await analyze([header, line], fakeJev(second).ask, [
      { ...item, received: 0 },
    ])
  ).lines;
  expect(first!.proposed).toBeNull();
  expect(first!.issues).toContain(
    "Ordered 10, shipped 6 and backordered 2 do not add up. Check the slip.",
  );
});

it("reads only the quantity cells under headings Jev is sure of", async () => {
  const jev = fakeJev({
    page: {
      // Unsure, and a weaker second box over the shipped column.
      backordered: { ...box(0.78, 0.86), confidence: 0.3 },
      ordered: { ...box(0.69, 0.75), confidence: 0.6 },
    },
  });
  const asked: string[][] = [];
  const ask: VisionAsk = (inputs, questions) => {
    asked.push(Object.keys(inputs));
    return jev.ask(inputs, questions);
  };
  const [read] = (await analyze([header, line], ask)).lines;
  expect(asked).toContainEqual(["shippedCell"]);
  expect(read!.proposed).toBe(6);
});

it("shows each line under the column headings, and no other line", async () => {
  // Jev's box for the headings runs on into the first line's type.
  const jev = fakeJev({ page: { header: box(0, 1, 0.09, 0.25) } });
  // Whether an image shows the first line's black type.
  const black = async (image: Buffer | string | undefined) =>
    (await sharp(image as Buffer).stats()).channels[0]!.min < 64;
  const seen: Array<[boolean, boolean]> = [];
  const ask: VisionAsk = async (inputs, questions) => {
    if (inputs.columnHeadings)
      seen.push([await black(inputs.columnHeadings), await black(inputs.row)]);
    return jev.ask(inputs, questions);
  };
  // The first line's type is black, the second's grey.
  const bar = (top: number, shade: number) => ({
    input: {
      create: {
        width: 900,
        height: 20,
        channels: 3 as const,
        background: { r: shade, g: shade, b: shade },
      },
    },
    left: 50,
    top,
  });
  const printed = await sharp(page)
    .composite([bar(280, 0), bar(420, 128)])
    .png()
    .toBuffer();
  const second = row(["DEF456", "Steel pipe", "5", "5", "0", "ea"], 0.3);
  await analyze([header, line, second], ask, [item], [printed]);
  expect(seen.map(([, row]) => row).sort()).toEqual([false, true]);
  for (const [headings, row] of seen) expect(headings).toBe(row);
});

it("checks each item's shipped total read from the whole page when no totals are printed", async () => {
  const noTotals = {
    lines: pick("not_printed", 0.95),
    range: pick("not_printed", 0.95),
  };
  // With printed totals the whole-page check is not needed.
  const footed = fakeJev({
    pageItems: { item0: pick("v8", 0.9) },
  });
  expect((await analyze([header, line], footed.ask)).lines[0]!.proposed).toBe(
    6,
  );
  expect(footed.calls).not.toContain("items");
  const disagree = fakeJev({
    page: noTotals,
    pageItems: { item0: pick("v8", 0.9) },
  });
  const [read] = (await analyze([header, line], disagree.ask)).lines;
  expect(read!.proposed).toBeNull();
  expect(read!.issues).toContain(
    "Reading the whole slip finds 8 shipped of this item, but the lines read add up to 6. Check the slip.",
  );
  // Unsure whole-page readings are ignored.
  const unsure = fakeJev({
    page: noTotals,
    pageItems: { item0: pick("v8", 0.6) },
  });
  expect((await analyze([header, line], unsure.ask)).lines[0]!.proposed).toBe(
    6,
  );
  // An item found on the page but on no line read.
  const other = { ...item, id: "b", sku: null, description: "Steel pipe" };
  const missed = fakeJev({
    page: noTotals,
    pageItems: { item0: pick("v6", 0.9), item1: pick("v3", 0.9) },
  });
  const result = await analyze([header, line], missed.ask, [item, other]);
  expect(result.warnings).toContain(
    "Reading the whole slip finds 3 shipped of “Steel pipe”, but no line was matched to it. Check for a missed line.",
  );
  expect(result.lines[0]!.proposed).toBe(6);
});

it("warns when a supplier's usual totals are missing", async () => {
  const memory = { known: {}, expectFooter: true };
  const none = fakeJev({
    page: {
      lines: pick("not_printed", 0.95),
      range: pick("not_printed", 0.95),
    },
  });
  const result = await analyze(
    [header, line],
    none.ask,
    [item],
    [page],
    memory,
  );
  expect(result.layout).toEqual({ footer: false });
  expect(result.warnings).toContain(
    "This supplier's slips usually print totals at the bottom, but none were found. Check that no page is missing or cut off.",
  );
  const printed = await analyze(
    [header, line],
    fakeJev({}).ask,
    [item],
    [page],
    memory,
  );
  expect(printed.layout).toEqual({ footer: true });
  expect(printed.warnings).toEqual([]);
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
  // The row view leans to the item, short of sure; the other two doubt it.
  const doubt = {
    ...pick("not_on_order", 0.7),
    probabilities: { item0: 0.3, not_on_order: 0.7 },
  };
  const jev = fakeJev({
    main: {
      part: { ...pick("item0", 0.85), probabilities: { item0: 0.85 } },
    },
    views: doubt,
  });
  const [read] = (await analyze([header, line], jev.ask, [uncoded])).lines;
  // (0.85 + 0.3 + 0.3) / 3 = 0.48 for the item; 0.47 against.
  expect(read!.orderItemId).toBe("a");
  expect(read!.confidence).toBe("low");
  expect(read!.issues).toEqual([
    "Check the product: only 48% sure it is this order item.",
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
  const [other] = (await analyze([header, line], notOrdered.ask, [uncoded]))
    .lines;
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
  // Each line starts just above its text, which Jev places less exactly. The
  // last ends where Jev's box does, moved down as far as Jev's lines sit
  // above their text.
  for (const [k, value] of [0.208, 0.288, 0.288, 0.37].entries())
    expect(edges.flat()[k]).toBeCloseTo(value, 3);
  expect(lines.map((l) => l.evidence)).toEqual([
    "Brass valve 6",
    "Steel pipe 6",
  ]);
});

it("finds the lines the table reader missed when Jev counts more on a page", async () => {
  const rows = { row1: box(0, 1, 0.19, 0.24), row2: box(0, 1, 0.27, 0.33) };
  const more = fakeJev({
    page: { count: pick("n2", 0.9), lines: pick("n2", 0.95) },
    total: pick("v12"),
    rows,
  });
  const { lines } = await analyze([header, line], more.ask);
  expect(more.calls).toContain("rows");
  // The line the table reader did find keeps its code and description. The
  // other starts where Jev put it, moved down as far as Jev placed the found
  // one above its text.
  expect(lines.map((l) => [l.sku, l.box!.y])).toEqual([
    ["ABC123", 0.198],
    [null, 0.278],
  ]);
  expect(lines[1]!.evidence).toBe("Line 2");
  // An unsure count leaves the table reader's lines alone.
  const unsure = fakeJev({ page: { count: pick("n2", 0.4) }, rows });
  expect((await analyze([header, line], unsure.ask)).lines).toHaveLength(1);
  expect(unsure.calls).not.toContain("rows");
});

it("reads a line Jev missed counting when the slip's printed count has room for it", async () => {
  const loose = [
    row(["Brass", "valve", "6"], 0.21),
    row(["Steel", "pipe", "6"], 0.26),
    row(["Copper", "tee", "6"], 0.31),
  ];
  const read = (printed: string) =>
    analyze(
      loose,
      fakeJev({
        page: {
          count: pick("n2", 0.95),
          lines: pick(printed, 0.95),
          range: pick("r0", 0.99),
        },
        total: pick("v18"),
        // Jev counts two lines and misses the middle one.
        rows: {
          row1: box(0, 1, 0.2, 0.25),
          row2: box(0, 1, 0.29, 0.34),
        },
      }).ask,
    );
  const { lines } = await read("n3");
  expect(lines.map((l) => l.evidence)).toEqual([
    "Brass valve 6",
    "Steel pipe 6",
    "Copper tee 6",
  ]);
  // A printed count that agrees with Jev's leaves no room.
  expect((await read("n2")).lines).toHaveLength(2);
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
