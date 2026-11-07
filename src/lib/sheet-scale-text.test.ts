import { describe, expect, it } from "vitest";
import {
  scaleFromSheetText,
  scaleReadMessage,
  type ScaleTextItem,
} from "./sheet-scale-text";

const INCH = 72;

function read(items: ScaleTextItem[], widthInches: number) {
  return scaleFromSheetText(items, widthInches * INCH);
}

function feet(items: ScaleTextItem[], widthInches = 36) {
  const result = read(items, widthInches);
  if (!result.ok) throw new Error(result.reason);
  return result.scale;
}

describe("printed scale text", () => {
  it("reads an architectural scale as the real width of the sheet", () => {
    const scale = feet([{ str: '1/4" = 1\'-0"', x: 0.8, y: 0.9 }]);
    expect(scale.unit).toBe("ft");
    expect(scale.unitsPerSheetWidth).toBeCloseTo(144);
    expect(scale.label).toBe('1/4" = 1\'-0"');
    expect(
      feet([{ str: '1/4" = 1\'-0"', x: 0.8, y: 0.9 }], 48).unitsPerSheetWidth,
    ).toBeCloseTo(192);
  });

  it("reads an engineering scale", () => {
    const scale = feet([{ str: "1\" = 20'", x: 0.3, y: 0.4 }]);
    expect(scale.unitsPerSheetWidth).toBeCloseTo(720);
    expect(scale.label).toBe('1" = 20\'-0"');
  });

  it("reads a metric ratio in meters", () => {
    const scale = feet([{ str: "SCALE 1:100", x: 0.8, y: 0.9 }]);
    expect(scale.unit).toBe("m");
    expect(scale.unitsPerSheetWidth).toBeCloseTo(91.44);
    expect(scale.label).toBe("1:100");
    const wide = feet([{ str: "1:100", x: 0.8, y: 0.9 }], 48);
    expect(wide.unitsPerSheetWidth).toBeCloseTo(121.92);
  });

  it("joins a scale that the PDF split into separate runs", () => {
    const scale = feet([
      { str: "SCALE:", x: 0.7, y: 0.9, w: 0.05 },
      { str: "1/4", x: 0.76, y: 0.9, w: 0.02 },
      { str: '"', x: 0.782, y: 0.9, w: 0.008 },
      { str: "= 1'-0\"", x: 0.795, y: 0.9, w: 0.06 },
    ]);
    expect(scale.unitsPerSheetWidth).toBeCloseTo(144);
    expect(scale.label).toBe('1/4" = 1\'-0"');
  });

  it("uses the scale under a SCALE label when another scale is also printed", () => {
    const scale = feet([
      { str: '1/2" = 1\'-0"', x: 0.1, y: 0.2 },
      { str: "SCALE:", x: 0.5, y: 0.48 },
      { str: '1/4" = 1\'-0"', x: 0.5, y: 0.5 },
    ]);
    expect(scale.label).toBe('1/4" = 1\'-0"');
    expect(scale.unitsPerSheetWidth).toBeCloseTo(144);
  });

  it("prefers the title block when the body of the sheet prints another scale", () => {
    const scale = feet([
      { str: '1/2" = 1\'-0"', x: 0.35, y: 0.4 },
      { str: 'SCALE: 1/4" = 1\'-0"', x: 0.8, y: 0.92 },
    ]);
    expect(scale.label).toBe('1/4" = 1\'-0"');
    expect(scale.unitsPerSheetWidth).toBeCloseTo(144);
  });

  it("refuses to guess when the title block prints two scales", () => {
    const result = read(
      [
        { str: 'SCALE: 1/4" = 1\'-0"', x: 0.8, y: 0.9 },
        { str: 'SCALE: 1/8" = 1\'-0"', x: 0.8, y: 0.94 },
      ],
      36,
    );
    expect(result).toEqual({
      ok: false,
      reason: "several",
      labels: ['1/4" = 1\'-0"', '1/8" = 1\'-0"'],
    });
  });

  it("says when the sheet tells you the scale is noted elsewhere", () => {
    expect(
      read([{ str: "SCALE : As indicated", x: 0.9, y: 0.95 }], 36),
    ).toEqual({
      ok: false,
      reason: "noted",
    });
    expect(read([{ str: "N.T.S.", x: 0.9, y: 0.95 }], 36)).toMatchObject({
      ok: false,
      reason: "noted",
    });
    expect(
      read(
        [
          { str: "2.19", x: 0.2, y: 0.95 },
          { str: "SCALE :", x: 0.927, y: 0.95 },
          { str: "As indicated", x: 0.95, y: 0.95 },
        ],
        36,
      ),
    ).toMatchObject({ ok: false, reason: "noted" });
    expect(
      read([{ str: "DRAWING NOT TO BE SCALED", x: 0.9, y: 0.02 }], 36),
    ).toMatchObject({
      ok: false,
      reason: "noted",
    });
  });

  it("reads a SCALE shorthand, a unicode scale, and the less common fractions", () => {
    expect(feet([{ str: 'SCALE: 1/8"', x: 0.8, y: 0.9 }]).label).toBe(
      '1/8" = 1\'-0"',
    );
    expect(
      feet([{ str: 'SCALE: 1/8"', x: 0.8, y: 0.9 }]).unitsPerSheetWidth,
    ).toBeCloseTo(288);
    expect(feet([{ str: "¼″ = 1′-0″", x: 0.8, y: 0.9 }]).label).toBe(
      '1/4" = 1\'-0"',
    );
    expect(
      feet([{ str: '3/16" = 1\'-0"', x: 0.8, y: 0.9 }]).unitsPerSheetWidth,
    ).toBeCloseTo(192);
    expect(feet([{ str: '1 1/2" = 1\'-0"', x: 0.8, y: 0.9 }]).label).toBe(
      '1 1/2" = 1\'-0"',
    );
    expect(
      feet([{ str: '1 1/2" = 1\'-0"', x: 0.8, y: 0.9 }]).unitsPerSheetWidth,
    ).toBeCloseTo(24);
  });

  it("does not invent a scale from a clock, a bare inch, or an empty page", () => {
    expect(
      read([{ str: "2026-07-08 11:23:08 AM", x: 0.8, y: 0.96 }], 36),
    ).toEqual({
      ok: false,
      reason: "none",
    });
    expect(read([{ str: 'SCALE: 1"', x: 0.8, y: 0.9 }], 36)).toEqual({
      ok: false,
      reason: "none",
    });
    expect(read([], 36)).toEqual({ ok: false, reason: "none" });
    expect(
      scaleFromSheetText([{ str: '1/4" = 1\'-0"', x: 0.8, y: 0.9 }], 0),
    ).toEqual({
      ok: false,
      reason: "none",
    });
  });

  it("keeps a printed scale when the sheet also says not to scale the drawing", () => {
    const scale = feet([
      { str: 'SCALE: 1/4" = 1\'-0"', x: 0.85, y: 0.93 },
      { str: "DRAWING NOT TO BE SCALED", x: 0.85, y: 0.02 },
    ]);
    expect(scale.unitsPerSheetWidth).toBeCloseTo(144);
  });

  it("describes why a scale was not applied", () => {
    expect(scaleReadMessage({ ok: false, reason: "none" })).toBe(
      "Couldn't read a scale from this drawing.",
    );
    expect(scaleReadMessage({ ok: false, reason: "noted" })).toBe(
      "This drawing doesn't give one scale for the whole sheet.",
    );
    expect(
      scaleReadMessage({
        ok: false,
        reason: "several",
        labels: ['1/4" = 1\'-0"', '1/8" = 1\'-0"'],
      }),
    ).toBe(
      'This drawing shows more than one scale (1/4" = 1\'-0" and 1/8" = 1\'-0").',
    );
  });
});
