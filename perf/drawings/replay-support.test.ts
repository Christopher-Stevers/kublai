// Authored during calibration quiet; execution is deferred.
import { describe, expect, it } from "vitest";
import { auditReplaySupport } from "./replay-support";
const capabilities = { glyphs: true, images: true, forms: true, strokeStyles: true };
const names = {
  1: "setGState", 2: "constructPath", 3: "stroke", 4: "setLineWidth",
  5: "beginMarkedContentProps", 6: "setTextRenderingMode", 7: "paintImageXObject",
  8: "paintFormXObjectBegin", 9: "setTextMatrix", 10: "transform",
};
const audit = (fnArray: number[], argsArray: unknown[], caps = capabilities) =>
  auditReplaySupport({ fnArray, argsArray }, names, caps);
describe("bounded prototype coverage audit", () => {
  it("accepts the declared stroke subset without certifying production eligibility", () => {
    const result = audit([1, 2], [
      [[["LW", 0], ["LC", 1], ["LJ", 2], ["ML", 10], ["D", [[2, 1], 0]],
        ["CA", 1], ["ca", 1], ["BM", "source-over"], ["SMask", false]]],
      [3, [new Float32Array([0, 1, 2, 1, 7, 8])]],
    ]);
    expect(result.failures).toEqual([]);
    expect(result.graphicsStateKeys).toMatchObject({ LW: 1, D: 1, BM: 1 });
    expect(result.subsetSupported).toBe(true);
    expect(result.completeEncoding).toBe(false);
    expect(result.productionEligible).toBe(false);
  });
  it("rejects silently ignored operators including layer-marked content", () => {
    const result = audit([5, 999], [["private label"], []]);
    expect(result.failureCounts).toEqual({ "unsupported-operator": 2 });
    expect(result.operationCounts).toEqual({ unsupported: 2 });
    expect(JSON.stringify(result)).not.toContain("private label");
  });
  it("accepts reference no-argument commands encoded as null or undefined", () => {
    const result = auditReplaySupport({
      fnArray: [1, 2, 3, 4], argsArray: [undefined, null, undefined, []],
    }, { 1: "save", 2: "nextLine", 3: "restore", 4: "endText" }, capabilities);
    expect(result.failures).toEqual([]);
    expect(audit([4], [undefined]).failures).toContain("invalid-operator-arguments");
  });
  it("rejects non-neutral transparency, transfer functions, fonts and unknown state keys", () => {
    const result = audit([1], [[[
      ["CA", 0.5], ["ca", 0], ["BM", "multiply"], ["SMask", true],
      ["Font", ["private font", 12]], ["TR", null], ["private key", 1],
    ]]]);
    expect(result.failures).toEqual(expect.arrayContaining([
      "unsupported-graphics-CA", "unsupported-graphics-ca", "unsupported-graphics-BM",
      "unsupported-graphics-SMask", "unsupported-graphics-Font",
      "unsupported-graphics-TR", "unsupported-graphics-key",
    ]));
    expect(JSON.stringify(result)).not.toContain("private key");
    expect(JSON.stringify(result)).not.toContain("private font");
  });
  it("rejects invalid styles instead of relying on canvas retaining an old style", () => {
    expect(audit([1], [[[
      ["LW", -1], ["LC", 5], ["LJ", NaN], ["ML", 0], ["D", [[0, 0], 0]],
    ]]]).failures).toEqual(expect.arrayContaining([
      "invalid-line-width", "invalid-line-cap-or-join", "invalid-miter-limit", "invalid-dash",
    ]));
    expect(audit([4], [[0]], { ...capabilities, strokeStyles: false }).failures)
      .toContain("stroke-styles-disabled");
  });
  it("fails unknown paint modes, commands, truncation and nonfinite coordinates", () => {
    const result = audit([2, 2, 2, 2], [
      [999, [[0, 1, 2]]], [3, [[99]]], [3, [[2, 1, 2]]], [3, [[0, Infinity, 0]]],
    ]);
    expect(result.failures).toEqual(expect.arrayContaining([
      "unsupported-path-paint", "unsupported-packed-command", "truncated-packed-command", "nonfinite-path-coordinate",
    ]));
  });
  it("requires explicit resources and valid form/text transforms", () => {
    const result = audit([7, 8, 9, 6], [["private-id"], [[1, 2], null], [[1, 2]], [1]],
      { glyphs: false, images: false, forms: false, strokeStyles: false });
    expect(result.failures).toEqual(expect.arrayContaining([
      "image-resources-disabled", "form-replay-disabled", "glyph-resources-disabled",
      "invalid-form-matrix", "invalid-text-matrix", "unsupported-text-rendering-mode",
    ]));
    expect(JSON.stringify(result)).not.toContain("private-id");
  });
  it("does not treat malformed lists, arguments or graphics states as empty success", () => {
    expect(audit([1], []).failures).toContain("invalid-operator-list");
    expect(audit([1], [null]).failures).toContain("invalid-operator-arguments");
    expect(audit([1], [[null]]).failures).toContain("invalid-graphics-state");
    expect(audit([10], [[1, 0, 0, 1, NaN, 0]]).failures).toContain("invalid-transform");
  });
});
