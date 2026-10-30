// @vitest-environment node
import sharp from "sharp";
import { beforeAll, expect, it, vi } from "vitest";
import { analyzeSlip, type Evaluator } from "./analyze";
import {
  bandsFromTable,
  snapColumns,
  type VisionAnswer,
  type VisionAsk,
} from "./vision";
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
  footer?: Answers;
}) {
  const calls: string[] = [];
  const ask: VisionAsk = async (inputs, questions) => {
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
    if (ids.includes("totals")) {
      calls.push("footer");
      return { totals: set.footer?.totals ?? box(0.5, 0.8, 0.6, 0.64) };
    }
    // The enlarged totals read as the page's unless set otherwise.
    if (ids.includes("lines")) {
      calls.push("footer read");
      return only({
        lines: set.page?.lines ?? pick("n1", 0.95),
        total: set.total ?? pick("v6", 0.99),
        ...set.footer,
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
      if ("penCell" in inputs) calls.push("pen crop");
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
) =>
  analyzeSlip(rows, items, noAssistant, {
    pages,
    ask,
    memory,
    forceImageReading: true,
  });
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
  // Page, the totals found and read enlarged, then the line and its cells.
  // The printed SKU settles the product, so no extra product views.
  expect(jev.calls.sort()).toEqual(
    ["cells", "footer", "footer read", "main", "page"].sort(),
  );
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
  // Read from an enlarged crop around the shipped cell.
  expect(jev.calls).toContain("pen crop");
  expect(read!.proposed).toBeNull();
  expect(read!.issues).toContain(
    "Handwriting on this line may change the quantity. Check the slip.",
  );
  // No handwriting: not asked.
  const plain = fakeJev({});
  await analyze([header, line], plain.ask);
  expect(plain.calls).not.toContain("handwritten");
  // A shipped figure written into the empty printed cell: the line reads
  // blank and the cell the figure, so the pen is read too.
  const filled = fakeJev({
    main: { shipped: pick("blank") },
    cells: { shipped: pick("v5") },
    hand: pick("v5", 0.9),
  });
  const [pen] = (await analyze([header, line], filled.ask)).lines;
  expect(filled.calls).toContain("handwritten");
  // The printed total and ordered less backordered both make it 6, but the
  // pen says 5.
  expect(pen).toMatchObject({ handwritten: 5, proposed: null });
  expect(pen!.issues).toContain(
    "Handwriting on this line may change the quantity. Check the slip.",
  );
  // The pen agreeing with the cell's 5 keeps the total from settling 6.
  const agreed = fakeJev({
    main: { shipped: pick("unclear", 0.4) },
    cells: { shipped: pick("v5") },
    hand: pick("v5", 0.9),
  });
  const [held] = (await analyze([header, line], agreed.ask)).lines;
  expect(held).toMatchObject({ shipped: 5, handwritten: 5, proposed: null });
  // An empty cell: nothing to read.
  const empty = fakeJev({
    main: { shipped: pick("blank") },
    cells: { shipped: pick("blank") },
  });
  await analyze([header, line], empty.ask);
  expect(empty.calls).not.toContain("handwritten");
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
  // A two-line heading 0.08 high is a heading still, however 0.33 - 0.25
  // rounds.
  const tall = fakeJev({
    page: {
      shipped: box(0.68, 0.74, 0.25, 0.33),
      ordered: { ...box(0.58, 0.64), confidence: 0.3 },
      backordered: { ...box(0.78, 0.86), confidence: 0.3 },
    },
  });
  asked.length = 0;
  await analyze([header, line], (inputs, questions) => {
    asked.push(Object.keys(inputs));
    return tall.ask(inputs, questions);
  });
  expect(asked).toContainEqual(["shippedCell"]);
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

it("widens the headings to take in every quantity column found", async () => {
  // Jev's box for the headings stops short of the Shipped heading, in red.
  const jev = fakeJev({ page: { header: box(0, 0.5) } });
  let headings: Buffer | undefined;
  const ask: VisionAsk = async (inputs, questions) => {
    if (inputs.columnHeadings) headings = inputs.columnHeadings as Buffer;
    return jev.ask(inputs, questions);
  };
  const printed = await sharp(page)
    .composite([
      {
        input: {
          create: {
            width: 40,
            height: 14,
            channels: 3,
            background: { r: 255, g: 0, b: 0 },
          },
        },
        left: 690,
        top: 136,
      },
    ])
    .png()
    .toBuffer();
  await analyze([header, line], ask, [item], [printed]);
  const { channels } = await sharp(headings).stats();
  expect(channels[1]!.min).toBeLessThan(64);
});

it("reads a continuation page's lines under the headings of the page that has them", async () => {
  // Page 2 is taller, and repeats no headings.
  const second = await sharp({
    create: { width: 1000, height: 1600, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const unsure = { ...box(0, 1), confidence: 0.2 };
  const jev = fakeJev({});
  const cells: string[][] = [];
  const ask: VisionAsk = async (inputs, questions) => {
    if (inputs.shippedCell) cells.push(Object.keys(inputs));
    if (inputs.page && "header" in questions) {
      const { width, height } = await sharp(inputs.page as Buffer).metadata();
      if (height / width > 1.5) {
        const answers = await jev.ask(inputs, questions);
        return {
          ...answers,
          shipped: unsure,
          ordered: unsure,
          backordered: unsure,
        };
      }
    }
    return jev.ask(inputs, questions);
  };
  const result = await analyze(
    [header, { ...line, page: 2 }],
    ask,
    [item],
    [page, second],
  );
  expect(result.lines[0]).toMatchObject({ shipped: 6, proposed: 6 });
  expect(cells).toHaveLength(1);
});

it("shows each quantity cell under its column's heading", async () => {
  const jev = fakeJev({});
  let shippedCell: Buffer | undefined;
  const ask: VisionAsk = async (inputs, questions) => {
    if (inputs.shippedCell) shippedCell = inputs.shippedCell as Buffer;
    return jev.ask(inputs, questions);
  };
  const mark = (left: number, top: number, width: number, r: number) => ({
    input: {
      create: {
        width,
        height: 14,
        channels: 3 as const,
        background: { r, g: 0, b: 0 },
      },
    },
    left,
    top,
  });
  // The Shipped heading is red; the line's shipped number, set to the right
  // under it, black.
  const printed = await sharp(page)
    .composite([mark(690, 136, 40, 255), mark(722, 284, 16, 0)])
    .png()
    .toBuffer();
  await analyze([header, line], ask, [item], [printed]);
  const { data, info } = await sharp(shippedCell)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rowsWhere = (test: (r: number, g: number) => boolean) =>
    Array.from({ length: info.height }, (_, y) => y).filter((y) =>
      Array.from(
        { length: info.width },
        (_, x) => (y * info.width + x) * 3,
      ).some((i) => test(data[i]!, data[i + 1]!)),
    );
  const red = rowsWhere((r, g) => r - g > 100),
    black = rowsWhere((r) => r < 64);
  expect(red.length).toBeGreaterThan(0);
  expect(black.length).toBeGreaterThan(0);
  expect(Math.max(...red)).toBeLessThan(Math.min(...black));
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

it("keeps the lines the whole page confirms when a missed line may explain the totals", async () => {
  // The slip lists a line that was not read.
  const missed = { lines: pick("n2", 0.95) };
  const confirmed = fakeJev({
    page: missed,
    pageItems: { item0: pick("v6", 0.9) },
  });
  const result = await analyze([header, line], confirmed.ask);
  expect(result.warnings).toEqual([
    "Check every line: the slip lists 2 lines but 1 were read.",
  ]);
  expect(result.lines[0]).toMatchObject({ proposed: 6, issues: [] });
  // An unsure whole-page reading confirms nothing.
  const unsure = fakeJev({
    page: missed,
    pageItems: { item0: pick("v6", 0.6) },
  });
  expect(
    (await analyze([header, line], unsure.ask)).lines[0]!.proposed,
  ).toBeNull();
  // With every line read and sure, a wrong total means one of them is wrong,
  // and the whole page cannot say which.
  const sure = fakeJev({
    total: pick("v7"),
    pageItems: { item0: pick("v6", 0.9) },
  });
  expect(
    (await analyze([header, line], sure.ask)).lines[0]!.proposed,
  ).toBeNull();
  expect(sure.calls).not.toContain("items");
});

it("keeps the sure lines when a line in review may square the printed total", async () => {
  const elbow: ReceiptOrderItem = {
    ...item,
    id: "b",
    description: "Copper elbow",
    sku: "XYZ789",
    received: 0,
  };
  const other = row(["XYZ789", "Copper elbow", "10", "3", "2", "ea"], 0.3);
  // The second line's crops are tinted, so the fake can tell them apart.
  const tinted = await sharp(page)
    .composite([
      {
        input: {
          create: {
            width: 1000,
            height: 56,
            channels: 3,
            background: { r: 230, g: 230, b: 230 },
          },
        },
        top: 434,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
  const isOther = async (image: Buffer | string | undefined) =>
    Buffer.isBuffer(image) &&
    (await sharp(image).stats()).channels[0]!.min < 240;
  // Jev reads its 8 as a 3, but thought 8 likely too.
  const unsure = {
    ...pick("v3", 0.6),
    probabilities: { v3: 0.6, v8: 0.35 },
  };
  const read = async (
    set: Parameters<typeof fakeJev>[0],
    shipped: ChoiceAnswer = unsure,
    kind = "one",
  ) => {
    const jev = fakeJev(set);
    const ask: VisionAsk = async (inputs, questions) => {
      const answers = await jev.ask(inputs, questions);
      if ("kind" in questions && (await isOther(inputs.row)))
        return {
          ...answers,
          kind: pick(kind, 0.99),
          part: { ...pick("item1", 0.95), probabilities: { item1: 0.95 } },
          shipped,
          backordered: pick("v2"),
        };
      if ("shippedCell" in inputs && (await isOther(inputs.shippedCell)))
        return { ...answers, shipped, backordered: pick("v2") };
      return answers;
    };
    return (await analyze([header, line, other], ask, [item, elbow], [tinted]))
      .lines;
  };
  const two = { lines: pick("n2", 0.95) };
  // Of the 3 and 8 Jev read, only 8 makes 14, as 10 ordered less 2
  // backordered does: the total settles it.
  const squared = await read({ page: two, total: pick("v14") });
  expect(squared.map((l) => l.proposed)).toEqual([6, 8]);
  expect(squared[1]!.issues).toEqual([]);
  expect(squared[1]!.notes).toContain(
    "The slip's printed total settles the shipped 8.",
  );
  // Not so a line that may hold more than one product; the sure line stands.
  const doubted = await read(
    { page: two, total: pick("v14") },
    unsure,
    "multiple",
  );
  expect(doubted.map((l) => l.proposed)).toEqual([6, null]);
  expect(doubted[0]!.issues).toEqual([]);
  // No reading of the line in review makes 15.
  const short = await read({ page: two, total: pick("v15") });
  expect(short.map((l) => l.proposed)).toEqual([null, null]);
  expect(short[0]!.issues).toEqual([
    "The slip's printed totals do not match the lines read.",
  ]);
  // A line may be missing too, so the total cannot settle the rest.
  const missing = await read({
    page: { lines: pick("n3", 0.95) },
    total: pick("v14"),
  });
  expect(missing.map((l) => l.proposed)).toEqual([null, null]);
  // A line Jev could not read may still ship only what it thought likely,
  // or what its ordered and backordered figures leave: 3 or 8.
  const unread = {
    ...pick("unclear", 0.6),
    probabilities: { unclear: 0.6, v3: 0.3 },
  };
  const fits = await read({ page: two, total: pick("v14") }, unread);
  expect(fits.map((l) => [l.shipped, l.proposed])).toEqual([
    [6, 6],
    [8, 8],
  ]);
  expect(fits[0]!.issues).toEqual([]);
  // Taking it as 0 would square a total of 6.
  for (const total of ["v13", "v6"]) {
    const off = await read({ page: two, total: pick(total) }, unread);
    expect(off.map((l) => l.proposed)).toEqual([null, null]);
    expect(off[0]!.issues).toEqual([
      "The slip's printed totals do not match the lines read.",
    ]);
  }
  // With no ordered column to check, a 3 squaring a total of 9 settles the
  // line only where Jev read it so, not where it thought it might be.
  const docket = {
    page: two,
    total: pick("v9"),
    main: { ordered: pick("no_column") },
    cells: { ordered: pick("no_column") },
  };
  const leaned = await read(docket);
  expect(leaned.map((l) => l.proposed)).toEqual([6, 3]);
  const guessed = await read(docket, unread);
  expect(guessed.map((l) => l.proposed)).toEqual([6, null]);
});

it("prefers the enlarged cell but blocks when it disagrees with the line", async () => {
  const cells = { shipped: pick("v8", 0.95) };
  const jev = fakeJev({ cells, total: pick("unclear") });
  const [read] = (await analyze([header, line], jev.ask)).lines;
  expect(read!.shipped).toBe(8);
  expect(read!.proposed).toBeNull();
  expect(read!.issues).toContain(
    "Shipped reads as 6 on the line and 8 in the cell. Check the slip.",
  );
  expect(read!.issues).toContain(
    "Ordered 10, shipped 8 and backordered 4 do not add up. Check the slip.",
  );
  // The slip's printed total of 6 settles it as the line read it.
  const [settled] = (await analyze([header, line], fakeJev({ cells }).ask))
    .lines;
  expect(settled).toMatchObject({ shipped: 6, proposed: 6, issues: [] });
});

it("reads a docket's one quantity column from its cell when the line finds no shipped column", async () => {
  const docket = { ordered: pick("no_column"), backordered: pick("no_column") };
  const jev = fakeJev({
    main: { shipped: pick("no_column", 0.85), ...docket },
    cells: { shipped: pick("v6", 0.83), ordered: pick("v6", 0.83) },
  });
  const [read] = (await analyze([header, line], jev.ask)).lines;
  expect(read).toMatchObject({ shipped: 6, proposed: 6, issues: [] });
  // An unreadable cell leaves nothing to read.
  const unclear = fakeJev({
    main: { shipped: pick("no_column", 0.85), ...docket },
    cells: { shipped: pick("unclear", 0.83) },
  });
  const [none] = (await analyze([header, line], unclear.ask)).lines;
  expect(none!.shipped).toBeNull();
});

it("drops the ordered figure a line reads where the slip has no ordered column", async () => {
  // A docket's one QTY heading, found as both the shipped and ordered column.
  const qty = box(0.68, 0.74);
  const page = {
    shipped: qty,
    ordered: { ...qty, confidence: 0.6 },
    backordered: { ...qty, confidence: 0.2 },
  };
  const docket = {
    main: {
      shipped: pick("no_column", 0.85),
      ordered: pick("v6", 0.64),
      backordered: pick("no_column"),
    },
    cells: { shipped: pick("v6", 0.94), ordered: pick("v6") },
  };
  const [read] = (
    await analyze([header, line], fakeJev({ ...docket, page }).ask)
  ).lines;
  expect(read).toMatchObject({ shipped: 6, proposed: 6, issues: [] });
  // A slip printing its own ordered column is held to it.
  const [held] = (await analyze([header, line], fakeJev(docket).ask)).lines;
  expect(held!.proposed).toBeNull();
  expect(held!.issues).toContain(
    "Check the product: the slip shows 6 ordered; the order has 10 ea.",
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
  // Or once the 2 delivered earlier are counted.
  const later = fakeJev({
    main: { shipped: pick("v6", 0.78), backordered: pick("v2", 0.7) },
    cells: { shipped: pick("v6", 0.78), backordered: pick("v2", 0.7) },
  });
  const [counted] = (await analyze([header, line], later.ask)).lines;
  expect(counted!.proposed).toBe(6);
  expect(counted!.issues).toEqual([]);
  // 13 ordered leaves 3 unaccounted for.
  const unbalanced = fakeJev({
    main: { shipped: pick("v6", 0.78), ordered: pick("v13") },
    cells: { shipped: pick("v6", 0.78), ordered: pick("v13") },
  });
  const [blocked] = (await analyze([header, line], unbalanced.ask)).lines;
  expect(blocked!.proposed).toBeNull();
  expect(blocked!.issues).toContain(
    "Check shipped quantity against the slip; the print is unclear.",
  );
});

it("reads a shipped figure hidden under a mark from the ordered and backordered figures", async () => {
  // A tick over the 6: Jev cannot say, but 6 is what it most saw there.
  const hidden = {
    main: {
      shipped: {
        ...pick("unclear", 0.45),
        probabilities: { unclear: 0.45, v6: 0.35, v8: 0.1 },
      },
    },
    cells: {
      shipped: {
        ...pick("v6", 0.5),
        probabilities: { v6: 0.5, unclear: 0.3, v5: 0.1 },
      },
    },
  };
  const fresh = { ...item, received: 0 };
  const [read] = (await analyze([header, line], fakeJev(hidden).ask, [fresh]))
    .lines;
  expect(read).toMatchObject({ shipped: 6, proposed: 6, issues: [] });
  expect(read!.notes).toContain(
    "The shipped figure is marked over; read from the ordered and backordered figures.",
  );
  // With 2 received earlier, the slip's 10 ordered and 4 backordered leave
  // 4 for this delivery, not the 6 Jev saw.
  const [earlier] = (
    await analyze(
      [header, line],
      fakeJev({ ...hidden, total: pick("unclear") }).ask,
    )
  ).lines;
  expect(earlier!.proposed).toBeNull();
  // And where Jev saw a 4, it stands.
  const sawFour = {
    shipped: {
      ...pick("unclear", 0.45),
      probabilities: { unclear: 0.45, v4: 0.35, v6: 0.1 },
    },
  };
  const four = fakeJev({
    main: sawFour,
    cells: sawFour,
    total: pick("v4", 0.99),
  });
  const [counted] = (await analyze([header, line], four.ask)).lines;
  expect(counted).toMatchObject({ shipped: 4, proposed: 4, issues: [] });
  expect(counted!.notes).toContain(
    "The slip's ordered quantity includes the 2 ea received earlier.",
  );
  // Jev saw a 5 there more than a 6.
  const five = fakeJev({
    ...hidden,
    total: pick("unclear"),
    cells: {
      shipped: {
        ...pick("v5", 0.6),
        probabilities: { v5: 0.6, unclear: 0.3, v6: 0.05 },
      },
    },
  });
  const [other] = (await analyze([header, line], five.ask, [fresh])).lines;
  expect(other!.proposed).toBeNull();
  // Backordered read differently in the cell settles nothing.
  const unsure = fakeJev({
    ...hidden,
    total: pick("unclear"),
    cells: { ...hidden.cells, backordered: pick("v3", 0.5) },
  });
  const [torn] = (await analyze([header, line], unsure.ask, [fresh])).lines;
  expect(torn!.proposed).toBeNull();
});

it("counts a 0, a blank and no column alike as nothing backordered", async () => {
  // Jev's doubt is over how the empty cell looks, not over the amount.
  const empty = (choice: string, other: string) => ({
    ...pick(choice, 0.5),
    probabilities: { [choice]: 0.5, [other]: 0.46, unclear: 0.04 },
  });
  const read = async (main: ChoiceAnswer, cell: ChoiceAnswer) => {
    const jev = fakeJev({
      total: pick("v8", 0.99),
      main: { shipped: pick("v8", 0.95), backordered: main },
      // With the 2 delivered earlier it adds up, but the cell's shipped is
      // too unsure to vouch for the line's.
      cells: { shipped: pick("v16", 0.4), backordered: cell },
    });
    return (await analyze([header, line], jev.ask)).lines[0];
  };
  expect(
    await read(empty("no_column", "blank"), empty("blank", "v0")),
  ).toMatchObject({ shipped: 8, backordered: 0, proposed: 8, issues: [] });
  // Torn between none and some, it still needs checking.
  const torn = await read(empty("v0", "v4"), empty("v0", "v4"));
  expect(torn!.proposed).toBeNull();
  expect(torn!.issues).toEqual([
    "Check backordered quantity against the slip.",
  ]);
});

it("trusts a backordered figure that balances sure shipped and ordered figures", async () => {
  // The line read is unsure of shipped, so the two reads do not agree; the
  // cell reads it surely.
  const read = async (backordered: ChoiceAnswer, ordered = pick("v10")) => {
    const jev = fakeJev({
      main: { shipped: pick("unclear", 0.45), backordered, ordered },
      cells: { shipped: pick("v6", 0.95), backordered, ordered },
    });
    return (await analyze([header, line], jev.ask)).lines[0];
  };
  expect(await read(pick("v4", 0.7))).toMatchObject({
    shipped: 6,
    backordered: 4,
    proposed: 6,
    issues: [],
  });
  // An unsure ordered figure fixes nothing.
  const unsure = await read(pick("v4", 0.7), pick("v10", 0.7));
  expect(unsure!.proposed).toBeNull();
  expect(unsure!.issues).toContain(
    "Check backordered quantity against the slip.",
  );
  // Nor does an unreadable backordered cell.
  const unclear = await read(pick("unclear", 0.7));
  expect(unclear!.proposed).toBeNull();
  expect(unclear!.issues).toContain(
    "Check backordered quantity against the slip.",
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

it("sets a quantity column under the OCR's words for its heading", () => {
  const word = (text: string, x: number, right: number, y: number) => ({
    text,
    x,
    y,
    width: right - x,
    height: 0.01,
    confidence: 90,
  });
  const heading = { top: 0.26, bottom: 0.3 };
  const words = [
    word("QTY", 0.085, 0.111, 0.258),
    word("QTY", 0.141, 0.167, 0.258),
    word("ORD", 0.08, 0.112, 0.274),
    word("SHP", 0.138, 0.169, 0.274),
    word("B/O", 0.202, 0.224, 0.276),
    { ...word("PRODUCT", 0.232, 0.29, 0.271), height: 0.02 },
    word("Prev", 0.63, 0.664, 0.27),
    word("Ship", 0.632, 0.662, 0.285),
  ];
  const snapped = snapColumns(
    {
      ordered: { ...heading, left: 0.07, right: 0.12 },
      shipped: { ...heading, left: 0.12, right: 0.15 },
      backordered: { ...heading, left: 0.17, right: 0.22 },
    },
    words,
  );
  // Up to the words' foot, short of the first line Jev's box runs into.
  expect(snapped.ordered).toMatchObject({
    top: 0.258,
    left: 0.08,
    right: 0.112,
  });
  expect(snapped.ordered!.bottom).toBeCloseTo(0.284);
  expect(snapped.shipped).toMatchObject({ left: 0.138, right: 0.169 });
  // A short heading still leaves a cell wide enough for its figures, though
  // not reaching halfway to the next heading, here one boxed with the rule.
  expect(snapped.backordered!.left).toBeCloseTo(0.198);
  expect(snapped.backordered!.right).toBeCloseTo(0.228);
  expect(snapped.backordered!.room!.left).toBeCloseTo(0.1855);
  expect(snapped.backordered!.room!.right).toBeCloseTo(0.228);
  // A shipped box over a Prev Ship heading is not moved onto it.
  const prev = { ...heading, left: 0.64, right: 0.68 };
  expect(snapColumns({ shipped: prev }, words).shipped).toBe(prev);
  // Nor is a box with no heading words over it.
  const bare = { ...heading, left: 0.4, right: 0.45 };
  expect(snapColumns({ ordered: bare }, words).ordered).toBe(bare);
});

it("finishes clear 98% OCR without calling either model", async () => {
  const ask = vi.fn<VisionAsk>();
  const evaluate = vi.fn<Evaluator>();
  const result = await analyzeSlip([header, line], [item], evaluate, {
    pages: [page],
    ask,
  });
  expect(result.lines[0]?.proposed).toBe(6);
  expect(result.model).toBe("table reader");
  expect(ask).not.toHaveBeenCalled();
  expect(evaluate).not.toHaveBeenCalled();
});

it("checks only the uncertain OCR row and preserves the clear row", async () => {
  const clear = row(["DEF456", "Copper tee", "10", "6", "4", "ea"], 0.3);
  const uncertain = structuredClone(line);
  uncertain.words[3]!.confidence = 40;
  const other = { ...item, id: "b", sku: "DEF456", description: "Copper tee" };
  const { ask, calls } = fakeJev({});
  const result = await analyzeSlip(
    [header, uncertain, clear],
    [item, other],
    noAssistant,
    { pages: [page], ask },
  );
  expect(calls.filter((c) => c === "main")).toHaveLength(1);
  expect(calls).not.toContain("items");
  expect(result.lines.find((l) => l.orderItemId === "b")?.source).toBe("table");
  expect(result.lines.find((l) => l.orderItemId === "b")?.proposed).toBe(6);
});
