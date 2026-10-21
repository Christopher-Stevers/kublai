/** Synthetic supplier packing slips for receiving tests and benchmarks.
 * Deterministic per seed: varied supplier layouts and abbreviations, partial
 * shipments, backorders, extra and missing lines, wrapped descriptions,
 * addresses, notes and totals. `slipRows` gives exact text positions, as a
 * PDF text layer would; scripts/benchmark-packing-slips.ts paints the pages
 * and reads them back with Tesseract. */
import type { ReceiptOrderItem } from "~/lib/packing-slip-review";
import type { SlipRow } from "./ocr-rows";

type Field =
  | "ordered"
  | "previous"
  | "shipped"
  | "backordered"
  | "qty"
  | "sku"
  | "description"
  | "unit"
  | "price"
  | "amount"
  | "line";
type Column = {
  label: string[];
  field: Field;
  width: number;
  align?: "left" | "right";
};
export type SlipText = {
  text: string;
  /** Left edge, or right edge when right-aligned; 0–1 of the page width. */
  x: number;
  /** Baseline, 0–1 of the page height. */
  y: number;
  size: number;
  align: "left" | "right";
  bold?: boolean;
};
export type SlipPage = {
  texts: SlipText[];
  rules: Array<{ x1: number; y1: number; x2: number; y2: number }>;
};
export type SlipTruth = {
  itemId: string | null;
  shipped: number;
  backordered: number;
  unit: string;
  description: string;
  page: number;
};
export type TestSlip = {
  name: string;
  layout: string;
  mono: boolean;
  items: ReceiptOrderItem[];
  truth: SlipTruth[];
  pages: SlipPage[];
};

export const LAYOUTS: Array<{ name: string; columns: Column[] }> = [
  {
    name: "qty-first",
    columns: [
      { label: ["QTY", "ORD"], field: "ordered", width: 0.065, align: "right" },
      { label: ["QTY", "SHP"], field: "shipped", width: 0.065, align: "right" },
      {
        label: ["QTY", "B/O"],
        field: "backordered",
        width: 0.065,
        align: "right",
      },
      { label: ["PRODUCT CODE"], field: "sku", width: 0.16 },
      { label: ["DESCRIPTION"], field: "description", width: 0.4 },
      { label: ["UM"], field: "unit", width: 0.05 },
      { label: ["UNIT PRICE"], field: "price", width: 0.1, align: "right" },
      { label: ["EXT PRICE"], field: "amount", width: 0.1, align: "right" },
    ],
  },
  {
    name: "item-first",
    columns: [
      { label: ["LN"], field: "line", width: 0.04, align: "right" },
      { label: ["ITEM #"], field: "sku", width: 0.16 },
      { label: ["DESCRIPTION"], field: "description", width: 0.42 },
      { label: ["ORDERED"], field: "ordered", width: 0.1, align: "right" },
      { label: ["SHIPPED"], field: "shipped", width: 0.1, align: "right" },
      {
        label: ["BACK ORDER"],
        field: "backordered",
        width: 0.12,
        align: "right",
      },
      { label: ["U/M"], field: "unit", width: 0.06 },
    ],
  },
  {
    name: "docket",
    columns: [
      { label: ["QTY"], field: "qty", width: 0.08, align: "right" },
      { label: ["ITEM"], field: "sku", width: 0.2 },
      { label: ["DESCRIPTION"], field: "description", width: 0.6 },
    ],
  },
  {
    name: "balance",
    columns: [
      { label: ["Product"], field: "sku", width: 0.16 },
      { label: ["Description"], field: "description", width: 0.42 },
      { label: ["Qty Ordered"], field: "ordered", width: 0.12, align: "right" },
      { label: ["Qty Shipped"], field: "shipped", width: 0.12, align: "right" },
      { label: ["Balance"], field: "backordered", width: 0.1, align: "right" },
    ],
  },
  {
    name: "erp",
    columns: [
      { label: ["Item Code"], field: "sku", width: 0.14 },
      { label: ["Description"], field: "description", width: 0.35 },
      { label: ["UOM"], field: "unit", width: 0.06 },
      {
        label: ["Order", "Qty"],
        field: "ordered",
        width: 0.07,
        align: "right",
      },
      {
        label: ["Prev", "Ship"],
        field: "previous",
        width: 0.07,
        align: "right",
      },
      { label: ["Ship", "Qty"], field: "shipped", width: 0.07, align: "right" },
      {
        label: ["B/O", "Qty"],
        field: "backordered",
        width: 0.07,
        align: "right",
      },
      { label: ["Price"], field: "price", width: 0.08, align: "right" },
      { label: ["Amount"], field: "amount", width: 0.09, align: "right" },
    ],
  },
  {
    name: "no-sku",
    columns: [
      { label: ["Description"], field: "description", width: 0.55 },
      { label: ["Ord"], field: "ordered", width: 0.09, align: "right" },
      { label: ["Ship"], field: "shipped", width: 0.09, align: "right" },
      { label: ["B/O"], field: "backordered", width: 0.09, align: "right" },
      { label: ["Unit"], field: "unit", width: 0.08 },
    ],
  },
];

type Family = {
  order: (s: string) => string;
  slip: Array<(s: string) => string>;
  unit?: "ea" | "ft" | "box" | "coil";
  sizes?: string[];
  pack?: number;
};
const SIZES = ["1/2", "3/4", "1", "1-1/4", "1-1/2", "2"];
const DWV = ["1-1/2", "2", "3", "4"];
const PEX = ["1/2", "3/4", "1"];
const FAMILIES: Family[] = [
  {
    order: (s) => `${s}" Copper 90° Elbow C x C`,
    slip: [
      (s) => `WROT CU 90 ELL ${s} CXC`,
      (s) => `${s} COPPER 90 ELBOW C X C`,
      (s) => `CXC 90 ELL ${s}`,
    ],
  },
  {
    order: (s) => `${s}" Copper Tee C x C x C`,
    slip: [(s) => `WROT CU TEE ${s} CXCXC`, (s) => `${s} COPPER TEE`],
  },
  {
    order: (s) => `${s}" Copper Coupling with Stop`,
    slip: [
      (s) => `WROT CU CPLG W/STOP ${s}`,
      (s) => `${s} CU COUPLING W/ STOP`,
    ],
  },
  {
    order: (s) => `${s}" Copper Male Adapter C x MPT`,
    slip: [(s) => `CU MALE ADPT ${s} CXM`, (s) => `${s} WROT C X MPT ADAPTER`],
  },
  {
    order: (s) => `${s}" Type L Copper Pipe`,
    slip: [
      (s) => `${s} TYPE L HARD COPPER TUBE 12FT`,
      (s) => `CU TUBE TYPE L ${s} X 12'`,
    ],
    unit: "ft",
  },
  {
    order: (s) => `${s}" Lead Free Brass Ball Valve Full Port Sweat`,
    slip: [
      (s) => `LF BRS BALL VLV FP SWT ${s}`,
      (s) => `${s} LEAD FREE FULL PORT BALL VALVE SWEAT`,
    ],
  },
  {
    order: (s) => `${s}" PVC DWV 45° Elbow H x H`,
    slip: [(s) => `PVC DWV 45 ELL ${s} HXH`, (s) => `${s} PVC DWV 45 ELBOW`],
    sizes: DWV,
  },
  {
    order: (s) => `${s}" PVC DWV Sanitary Tee`,
    slip: [(s) => `PVC DWV SAN TEE ${s}`, (s) => `${s} PVC SANITARY TEE HXHXH`],
    sizes: DWV,
  },
  {
    order: (s) => `${s}" ABS Cleanout Adapter with Plug`,
    slip: [
      (s) => `ABS C/O ADPT W/PLUG ${s}`,
      (s) => `${s} ABS CLEANOUT ADAPTER & PLUG`,
    ],
    sizes: DWV,
  },
  {
    order: (s) => `${s}" PEX-A Tubing 100ft Coil`,
    slip: [
      (s) => `PEX-A TUBING ${s} X 100' COIL`,
      (s) => `${s} PEXA PIPE 100FT`,
    ],
    unit: "coil",
    sizes: PEX,
  },
  {
    order: (s) => `${s}" PEX Expansion Ring`,
    slip: [(s) => `PEX EXP RING ${s}`, (s) => `${s} PEX-A EXPANSION RING`],
    sizes: PEX,
  },
  {
    order: (s) => `${s}" Copper Clevis Hanger`,
    slip: [
      (s) => `CU PLTD CLEVIS HGR ${s}`,
      (s) => `${s} COPPER EPOXY CLEVIS HANGER`,
    ],
  },
  {
    order: (s) => `${s}" x 6" Black Steel Nipple`,
    slip: [(s) => `BLK NIPPLE ${s} X 6`, (s) => `${s} X 6 BLACK STEEL NIPPLE`],
  },
  {
    order: (s) => `${s}" Copper Reducing Coupling`,
    slip: [
      (s) => `WROT CU RED CPLG ${s.replace(" x ", "X")}`,
      (s) => `${s} COPPER REDUCING COUPLING`,
    ],
    sizes: ["3/4 x 1/2", "1 x 3/4", "1-1/4 x 1", "1 x 1/2"],
  },
  {
    order: () => `3/8" Threaded Rod Zinc x 10ft`,
    slip: [
      () => `3/8-16 X 10' ZINC ALL THREAD`,
      () => `THREADED ROD 3/8 X 10FT ZINC`,
    ],
    sizes: ["3/8"],
  },
  {
    order: () => `#10 x 1" Hex Head Self Driller (Box = 100pcs)`,
    slip: [
      () => `#10 X 1 HEX HEAD SELF DRILL SCREW 100/BX`,
      () => `SCREW HEX SELF DRILLER #10X1 BOX/100`,
    ],
    unit: "box",
    pack: 100,
    sizes: ["#10"],
  },
  {
    order: (s) => `${s}" Copper Cap`,
    slip: [(s) => `WROT CU CAP ${s}`, (s) => `${s} COPPER CAP`],
  },
];
const EXTRAS = [
  "TEFLON TAPE 1/2 X 520",
  "LEAD FREE SOLDER 1LB SPOOL",
  "WATER SOLUBLE FLUX PASTE 4OZ",
  "PVC CEMENT MEDIUM BODY 473ML",
  "SANDING CLOTH ROLL 1-1/2 X 10YD",
  "PIPE DOPE 8OZ",
];
const SUPPLIERS = [
  ["WESTCOAST PLUMBING SUPPLY LTD", "1234 INDUSTRIAL WAY", "SURREY BC V3S 1A1"],
  ["Pacific Pipe & Valve", "88 Marine Drive Unit 4", "Burnaby, BC V5J 3G2"],
  ["NORTHLAND MECHANICAL WHOLESALE", "4500 - 192 STREET", "LANGLEY BC V3Z 0B7"],
];

function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Approximate advance per character as a fraction of the font size. */
export const charWidth = (mono: boolean) => (mono ? 0.6 : 0.54);

export function makeSlip(
  seed: number,
  overrides: { layout?: string; items?: number } = {},
): TestSlip {
  const rnd = random(seed * 7919 + 13);
  const pick = <T>(list: readonly T[]) =>
    list[Math.floor(rnd() * list.length)]!;
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const layout = overrides.layout
    ? LAYOUTS.find((l) => l.name === overrides.layout)!
    : LAYOUTS[seed % LAYOUTS.length]!;
  const mono = rnd() < 0.4;
  const fields = new Set(layout.columns.map((c) => c.field));
  const secondDelivery = fields.has("previous") ? rnd() < 0.5 : rnd() < 0.15;

  // Order: distinct products, often several sizes of the same fitting.
  const count = overrides.items ?? int(4, 14);
  const chosen = new Map<string, { family: Family; size: string }>();
  while (chosen.size < count) {
    const family = pick(FAMILIES);
    const size = pick(family.sizes ?? SIZES);
    chosen.set(`${FAMILIES.indexOf(family)}:${size}`, { family, size });
  }
  const items: Array<
    ReceiptOrderItem & { slip: string; code: string; pack?: number }
  > = [];
  let n = 0;
  for (const { family, size } of chosen.values()) {
    const unit = family.unit ?? "ea";
    const ordered =
      unit === "ft"
        ? int(2, 20) * pick([10, 12])
        : unit === "box" || unit === "coil"
          ? int(1, 5)
          : pick([1, 2, 2, 4, 5, 6, 8, 10, 12, 15, 20, 24, 25, 30, 40, 50]);
    const shownSize = pick([
      size,
      size,
      `${size}"`,
      size.replace("-", " "),
      `${size}IN`,
    ]).replace(/ x /, pick([" x ", "X", " X "]));
    const code =
      pick(["W", "NL", "C", "P", "LF", "AB", ""]) +
      String(int(1000, 99999)) +
      (rnd() < 0.3 ? `-${int(1, 9)}${pick(["", "A", "C"])}` : "");
    const received = secondDelivery ? Math.floor(ordered * rnd() * 0.7) : 0;
    items.push({
      id: `item-${++n}`,
      description: family.order(size),
      sku: rnd() < 0.7 ? code : null,
      aliases: [],
      ordered,
      received,
      verificationStatus: received ? "partial" : "pending",
      unit,
      piecesPerPack: family.pack ?? null,
      individualUnit: family.pack ? "pcs" : null,
      slip: pick(family.slip)(shownSize),
      code,
      pack: family.pack,
    });
  }

  // Slip lines: mostly shipped in full, some partial, backordered or missing,
  // plus occasional extras that were never ordered.
  type Line = {
    item: (typeof items)[number] | null;
    description: string;
    code: string;
    ordered: number;
    previous: number;
    shipped: number;
    backordered: number;
    unit: string;
    printedQty: number;
  };
  const lines: Line[] = [];
  for (const item of items) {
    const outstanding = item.ordered - item.received;
    const r = rnd();
    if (r < 0.08 || outstanding <= 0) continue;
    const shipped =
      r < 0.66 || outstanding === 1
        ? outstanding
        : r < 0.9
          ? int(1, outstanding - 1)
          : 0;
    lines.push({
      item,
      description: item.slip,
      code: item.code,
      ordered: item.ordered,
      previous: item.received,
      shipped,
      backordered: outstanding - shipped,
      unit: item.unit,
      printedQty: shipped,
    });
  }
  for (let extra = rnd() < 0.3 ? int(1, 2) : 0; extra > 0; extra--) {
    const qty = int(1, 12);
    lines.push({
      item: null,
      description: pick(EXTRAS),
      code: String(int(10000, 99999)),
      ordered: qty,
      previous: 0,
      shipped: qty,
      backordered: 0,
      unit: "ea",
      printedQty: qty,
    });
  }
  if (rnd() < 0.5) lines.sort(() => rnd() - 0.5);

  const unitText = (line: Line) => {
    if (line.unit === "ft") return "FT";
    if (line.unit === "box") return pick(["BX", "BOX"]);
    if (line.unit === "coil") return pick(["CL", "COIL", "EA"]);
    return pick(["EA", "EA", "EA", "PC", "EACH"]);
  };
  const units = lines.map(unitText);

  // Page geometry
  const body = mono ? 0.0092 : 0.0098,
    pitch = body * pick([1.9, 2.1, 2.4]),
    left = 0.06,
    span = 0.88;
  const scale = span / layout.columns.reduce((s, c) => s + c.width, 0);
  const columns = layout.columns.map((c, i, all) => {
    const start =
      left + all.slice(0, i).reduce((s, x) => s + x.width, 0) * scale;
    return { ...c, start, end: start + c.width * scale };
  });
  const pages: SlipPage[] = [];
  const truth: SlipTruth[] = [];
  const supplier = pick(SUPPLIERS);
  const orderNo = `SO-${int(400000, 499999)}`;
  const perPage = lines.length > 10 && rnd() < 0.6 ? int(6, 9) : 99;
  const pageCount = Math.max(1, Math.ceil(lines.length / perPage));
  const repeatHeader = rnd() < 0.8;
  let lineNo = 0;
  for (let p = 0; p < pageCount; p++) {
    const page: SlipPage = { texts: [], rules: [] };
    pages.push(page);
    const text = (
      t: string,
      x: number,
      y: number,
      options: Partial<SlipText> = {},
    ) =>
      page.texts.push({ text: t, x, y, size: body, align: "left", ...options });
    let y = 0.06;
    if (p === 0 || repeatHeader) {
      text(supplier[0]!, left, y, { size: body * 1.5, bold: true });
      text("PACKING SLIP", 1 - left, y, {
        size: body * 1.8,
        bold: true,
        align: "right",
      });
      y += pitch * 1.3;
      text(supplier[1]!, left, y);
      text(`Order No: ${orderNo}`, 0.62, y);
      y += pitch;
      text(supplier[2]!, left, y);
      text(`Ship Date: 10/${int(10, 28)}/2026`, 0.62, y);
      y += pitch;
      text(`Phone 604-555-${int(1000, 9999)}`, left, y);
      text(`Customer PO: ALMA-${int(1000, 9999)}`, 0.62, y);
      y += pitch * 1.6;
      text("SHIP TO:", left, y, { bold: true });
      text("SOLD TO:", 0.5, y, { bold: true });
      y += pitch;
      text("ALMA RESIDENCE - JOB 2231", left, y);
      text("FOREMAN PLUMBING & HEATING", 0.5, y);
      y += pitch;
      text(`${int(100, 9999)} W ${int(1, 49)}TH AVE`, left, y);
      text(`PO BOX ${int(100, 999)}`, 0.5, y);
      y += pitch;
      text("VANCOUVER BC V6M 2B4", left, y);
      text("RICHMOND BC V6X 1A1", 0.5, y);
      y += pitch * 1.4;
      text(`Ship Via: ${pick(["OUR TRUCK", "WILL CALL", "COURIER"])}`, left, y);
      text(`Page ${p + 1} of ${pageCount}`, 1 - left, y, { align: "right" });
      y += pitch * 1.8;
    } else {
      text(`${orderNo} continued - Page ${p + 1} of ${pageCount}`, left, y);
      y += pitch * 2;
    }
    // Table header, sometimes over two lines.
    const twoLine = columns.some((c) => c.label.length > 1);
    page.rules.push({ x1: left, y1: y - pitch, x2: 1 - left, y2: y - pitch });
    if (p === 0 || repeatHeader) {
      for (const c of columns)
        c.label.forEach((label, k) =>
          text(
            label,
            c.align === "right" ? c.end - 0.006 : c.start,
            y + (twoLine ? (k - c.label.length + 2) * pitch * 0.9 : 0),
            { bold: true, align: c.align ?? "left" },
          ),
        );
      y += twoLine ? pitch * 0.9 : 0;
      page.rules.push({
        x1: left,
        y1: y + pitch * 0.45,
        x2: 1 - left,
        y2: y + pitch * 0.45,
      });
      y += pitch * 1.3;
    }
    const descWidth = columns.find((c) => c.field === "description")!;
    const maxChars = Math.floor(
      (descWidth.end - descWidth.start - 0.01) /
        (body * charWidth(mono) * 1.29),
    );
    for (const line of lines.slice(p * perPage, (p + 1) * perPage)) {
      const index = lines.indexOf(line);
      lineNo++;
      const price = (3 + rnd() * 140).toFixed(2);
      const value: Record<Field, string> = {
        ordered: String(line.ordered),
        previous: String(line.previous),
        shipped: String(line.printedQty),
        backordered: String(line.backordered),
        qty: String(line.printedQty),
        sku: line.code,
        description: line.description,
        unit: units[index]!,
        price,
        amount: (Number(price) * line.printedQty).toFixed(2),
        line: String(lineNo),
      };
      // Pack items sometimes counted in pieces.
      if (line.item?.pack && units[index] !== "BX" && rnd() < 0.3) {
        value.unit = "PC";
        value.shipped = value.qty = String(line.printedQty * line.item.pack);
        value.ordered = String(line.ordered * line.item.pack);
        value.previous = String(line.previous * line.item.pack);
        value.backordered = String(line.backordered * line.item.pack);
      }
      // Some slips leave zero cells blank.
      const blankZero = rnd() < 0.3;
      let description = value.description,
        overflow = "";
      if (description.length > maxChars) {
        const cut = description.lastIndexOf(" ", maxChars);
        overflow = description.slice(cut + 1);
        description = description.slice(0, cut);
      }
      for (const c of columns) {
        let t = c.field === "description" ? description : value[c.field];
        if (blankZero && t === "0" && c.field !== "shipped") t = "";
        if (!t) continue;
        text(t, c.align === "right" ? c.end - 0.006 : c.start, y, {
          align: c.align ?? "left",
        });
      }
      truth.push({
        itemId: line.item?.id ?? null,
        shipped: line.shipped,
        backordered: line.backordered,
        unit: line.unit,
        description: line.description,
        page: p + 1,
      });
      y += pitch;
      if (overflow) {
        text(overflow, descWidth.start, y);
        y += pitch;
      } else if (line.item && rnd() < 0.08) {
        text(`MFR# ${line.code.replace(/\D/g, "")}`, descWidth.start, y);
        y += pitch;
      }
      if (line.backordered > 0 && rnd() < 0.15) {
        text(
          "** BACKORDERED - WILL SHIP WHEN AVAILABLE **",
          descWidth.start,
          y,
        );
        y += pitch;
      }
    }
    page.rules.push({ x1: left, y1: y, x2: 1 - left, y2: y });
    y += pitch * 1.5;
    if (p === pageCount - 1) {
      const shipped = lines.reduce((s, l) => s + l.printedQty, 0);
      text(`TOTAL QTY SHIPPED: ${shipped}`, 0.55, y, { bold: true });
      y += pitch;
      text(`Total lines: ${lines.length}`, 0.55, y);
      y += pitch * 2;
      text("Received by: ______________________   Date: __________", left, y);
      y += pitch * 1.4;
      text(
        "All claims for shortages must be made within 5 days of receipt.",
        left,
        y,
        { size: body * 0.85 },
      );
    }
  }
  return {
    name: `${seed}:${layout.name}${mono ? "/mono" : ""}${secondDelivery ? "/2nd" : ""}`,
    layout: layout.name,
    mono,
    items: items.map(
      ({ slip: _slip, code: _code, pack: _pack, ...item }) => item,
    ),
    truth,
    pages,
  };
}

/** Text runs per row with their exact boxes, as a PDF text layer gives them. */
export function slipRows(slip: TestSlip): SlipRow[] {
  return slip.pages.flatMap((page, p) => {
    const rows = new Map<number, SlipRow["words"]>();
    for (const t of page.texts) {
      const width = t.text.length * t.size * charWidth(slip.mono) * 1.29,
        key = Math.round(t.y * 2000);
      const x = t.align === "right" ? t.x - width : t.x;
      (rows.get(key) ?? rows.set(key, []).get(key)!).push({
        text: t.text,
        x,
        y: t.y - t.size * 0.75,
        width,
        height: t.size,
        confidence: 100,
      });
    }
    return [...rows.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, words]) => {
        words.sort((a, b) => a.x - b.x);
        return {
          page: p + 1,
          words,
          text: words.map((w) => w.text).join(" "),
        };
      });
  });
}
