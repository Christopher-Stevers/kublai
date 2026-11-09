// @vitest-environment node
import sharp from "sharp";
import { expect, it } from "vitest";
import {
  acceptedCodes,
  codesByPart,
  learnedColumns,
  type ConfirmedSlip,
} from "./memory";
import { measurePage, qualityWarnings } from "./page-quality";

const line = (
  sku: string,
  orderItemId: string,
  proposed: number | null,
  linked?: "user",
) => ({ sku, orderItemId, proposed, ...(linked ? { linked } : {}) });

it("learns codes only from lines the user accepted or linked", () => {
  const slip: ConfirmedSlip = {
    lines: [
      line("SUP-100", "i1", 4), // prefilled and confirmed as 4
      line("SUP-200", "i2", 3), // prefilled, user changed to 5
      line("SUP-300", "i3", null, "user"), // linked by hand
      line("AB", "i4", 1), // too short to be a code
    ],
    applied: { quantities: { i1: 4, i2: 5, i3: 2, i4: 1 } },
  };
  expect(acceptedCodes([slip])).toEqual([
    { code: "SUP100", orderItemId: "i1" },
    { code: "SUP300", orderItemId: "i3" },
  ]);
});

it("drops codes that meant different products", () => {
  const parts = new Map([
    ["i1", "p1"],
    ["i2", "p1"],
    ["i3", "p2"],
    ["i4", "p3"],
  ]);
  const byPart = codesByPart(
    [
      { code: "SUP100", orderItemId: "i1" },
      { code: "SUP100", orderItemId: "i2" },
      { code: "SUP300", orderItemId: "i3" },
      { code: "SUP300", orderItemId: "i4" },
    ],
    parts,
  );
  expect(Object.fromEntries(byPart)).toEqual({ p1: ["SUP100"] });
});

it("learns where a supplier prints its quantity columns once two of its last three slips agree", () => {
  const at = (left: number, right: number) => ({ left, right });
  const layout = (
    columns: NonNullable<ConfirmedSlip["layout"]>["columns"],
  ) => ({ footer: true, columns });
  // Newest first. The third slip's shipped column was misread; the fourth
  // is older than the last three that showed it.
  const learned = learnedColumns([
    layout({ shipped: at(0.73, 0.79), backordered: at(0.8, 0.88) }),
    layout({ shipped: at(0.72, 0.78) }),
    layout({ shipped: at(0.5, 0.56), backordered: at(0.81, 0.89) }),
    layout({ shipped: at(0.1, 0.2) }),
  ]);
  expect(Object.keys(learned ?? {}).sort()).toEqual(["backordered", "shipped"]);
  expect(learned?.shipped?.left).toBeCloseTo(0.725);
  expect(learned?.shipped?.right).toBeCloseTo(0.785);
  expect(learned?.backordered?.left).toBeCloseTo(0.805);
  expect(learned?.backordered?.right).toBeCloseTo(0.885);
  // One slip, slips that disagree, or slips from before columns were kept,
  // teach nothing.
  expect(learnedColumns([layout({ shipped: at(0.72, 0.78) })])).toBeUndefined();
  expect(
    learnedColumns([
      layout({ shipped: at(0.72, 0.78) }),
      layout({ shipped: at(0.5, 0.56) }),
    ]),
  ).toBeUndefined();
  expect(learnedColumns([{ footer: true }, { footer: false }])).toBeUndefined();
});

it("warns about blurry or dark pages but not a clean one", async () => {
  // Rows of ink blocks stand in for print; text would depend on fonts.
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1300"><rect width="100%" height="100%" fill="white"/>${Array.from(
      { length: 30 },
      (_, i) =>
        Array.from(
          { length: 14 },
          (_, k) =>
            `<rect x="${60 + k * 60}" y="${80 + i * 38}" width="${8 + (k % 4) * 9}" height="20" fill="black"/>`,
        ).join(""),
    ).join("")}</svg>`,
  );
  const clean = await sharp(svg).png().toBuffer();
  expect(qualityWarnings(1, await measurePage(clean))).toEqual([]);
  const blurry = await sharp(clean).blur(4).png().toBuffer();
  expect(qualityWarnings(1, await measurePage(blurry))).toContain(
    "Page 1 looks blurry. Check the numbers against the paper slip, or scan it again holding the phone still.",
  );
  const dark = await sharp(clean).linear(0.3, 0).png().toBuffer();
  expect(qualityWarnings(2, await measurePage(dark))[0]).toMatch(
    /^Page 2 looks too dark/,
  );
});
