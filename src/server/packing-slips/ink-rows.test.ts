// @vitest-environment node
import sharp from "sharp";
import { expect, it } from "vitest";
import { inkRows } from "./ink-rows";

const W = 1000,
  H = 1400;
type Colour = [number, number, number];
const TYPE: Colour = [40, 40, 40];

/** A page as `draw` marks it, white elsewhere. */
function page(draw: (fill: Fill) => void) {
  const data = Buffer.alloc(W * H * 3, 255);
  draw((x0, y0, x1, y1, colour, letters = false) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        // Letters leave gaps, as type does.
        if (letters && (x - x0) % 2) continue;
        data.set(colour, (y * W + x) * 3);
      }
  });
  return sharp(data, { raw: { width: W, height: H, channels: 3 } })
    .png()
    .toBuffer();
}
type Fill = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colour: Colour,
  letters?: boolean,
) => void;
/** A row of type starting `y` pixels down: a code, a description and, unless
 * it is wrapped text, two quantities. */
const typeRow = (fill: Fill, y: number, wrapped = false, colour = TYPE) => {
  const word = (x0: number, x1: number) =>
    fill(x0, y, x1, y + 12, colour, true);
  if (wrapped) return word(220, 380);
  word(60, 140);
  word(200, 380);
  word(610, 630);
  word(710, 730);
};
const ROWS = [280, 320, 360, 400, 440];
const region = { top: 0.15, bottom: 0.4, left: 0, right: 1 };
const quantity = [
  { left: 0.6, right: 0.66 },
  { left: 0.7, right: 0.76 },
];
const rows = async (draw: (fill: Fill) => void) =>
  inkRows(await page(draw), region, quantity);
const near = (found: Array<{ y: number }>, want: number[]) => {
  expect(found).toHaveLength(want.length);
  found.forEach((r, k) =>
    expect(Math.abs(r.y - want[k]! / H)).toBeLessThan(0.002),
  );
};

it("finds where each row of type starts, and how much quantity ink it has", async () => {
  const found = await rows((fill) =>
    ROWS.forEach((y, k) => typeRow(fill, y, k === 2)),
  );
  near(found, ROWS);
  // The wrapped description has none.
  expect(found.map((r) => Math.round(r.quantity * 10) / 10)).toEqual([
    1, 1, 0, 1, 1,
  ]);
});

it("passes over ruled lines, straight or bent", async () => {
  const found = await rows((fill) => {
    ROWS.forEach((y) => typeRow(fill, y));
    fill(0, 304, W, 306, TYPE);
    for (let x = 0; x < W; x++) {
      const y = Math.round(383 + 4 * Math.sin((Math.PI * x) / W));
      fill(x, y, x + 1, y + 2, TYPE);
    }
  });
  near(found, ROWS);
});

it("finds rows boxed in by rules", async () => {
  const found = await rows((fill) =>
    ROWS.forEach((y) => {
      typeRow(fill, y);
      fill(0, y + 15, W, y + 17, TYPE);
    }),
  );
  near(found, ROWS);
});

it("passes over a shadow's edge, even just under a row", async () => {
  for (const edge of [345, 335]) {
    const found = await rows((fill) => {
      fill(0, edge, W, H, [190, 190, 190]);
      ROWS.forEach((y) => typeRow(fill, y));
    });
    near(found, ROWS);
  }
});

it("keeps a row of type a shadow's edge runs through", async () => {
  const found = await rows((fill) => {
    fill(0, 326, W, H, [190, 190, 190]);
    ROWS.forEach((y) => typeRow(fill, y));
  });
  near(found, ROWS);
});

it("passes over rules that stop short of the edges", async () => {
  const found = await rows((fill) => {
    ROWS.forEach((y) => typeRow(fill, y));
    fill(0, 304, 650, 306, TYPE);
  });
  near(found, ROWS);
});

it("does not see highlighter or coloured pen", async () => {
  const found = await rows((fill) => {
    // Highlighter over a row and across a gap.
    fill(180, 272, 420, 300, [250, 235, 80]);
    fill(180, 336, 420, 356, [250, 235, 80]);
    ROWS.forEach((y) => typeRow(fill, y));
    // A red tick across the gap between rows.
    for (let y = 296; y < 346; y++) {
      const x = 450 + Math.round((y - 296) * 0.4);
      fill(x, y, x + 3, y + 1, [225, 45, 45]);
    }
  });
  near(found, ROWS);
});
