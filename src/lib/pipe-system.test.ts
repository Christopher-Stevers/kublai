import { describe, expect, it } from "vitest";
import { buildPipeSystemIndex, selectPipeSystem, selectPipeLayerSystem, pipeLayerCodes, type PipeLabel, type PipeLinework, type PipeSegment } from "./pipe-system";

function line(id: string, x1: number, y1: number, x2: number, y2: number, extra: Partial<PipeSegment> = {}): PipeSegment {
  return { id, pathId: id, x1, y1, x2, y2, stroke: "#111111", width: 0.001, dash: [], ...extra };
}

function label(system: string, x: number, y: number, width = 0.02, height = 0.01): PipeLabel {
  return { text: system, system, left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 };
}

function index(segments: PipeSegment[], labels: PipeLabel[] = [], extra: Partial<PipeLinework> = {}) {
  return buildPipeSystemIndex({ segments, labels, aspect: 1, truncated: false, ...extra });
}

function ids(selection: ReturnType<typeof selectPipeSystem>) {
  return selection.segments.filter((segment) => !segment.id.startsWith("pipe-bridge:")).map((segment) => segment.id).sort();
}

describe("pipe system trace", () => {
  it("selects all source-tagged runs, including below-grade variants, without borrowing nearby labels", () => {
    const linework: PipeLinework = { aspect: 1, truncated: false, labels: [label("SAN", 0.5, 0.5)], segments: [
      line("above", 0.1, 0.1, 0.2, 0.1, { layer: "M-PLMB-SANI" }),
      line("below", 0.7, 0.7, 0.8, 0.7, { layer: "xref|M-PLMB-SANI-BELW" }),
      line("untagged", 0.4, 0.5, 0.6, 0.5),
      line("storm", 0.1, 0.2, 0.2, 0.2, { layer: "M-PLMB-STRM" }),
      line("fire", 0.2, 0.2, 0.3, 0.2, { layer: "M-FIRE-PIPE" }),
      line("gas", 0.3, 0.3, 0.4, 0.3, { layer: "M-FUEL-GAS" }),
    ] };
    expect(pipeLayerCodes(linework)).toEqual(["FIRE", "GAS", "SAN", "ST"]);
    const selection = selectPipeLayerSystem(linework, "SAN");
    expect(ids(selection)).toEqual(["above", "below"]);
    expect(selection.lengthInSheetWidths).toBeCloseTo(0.2);
    expect(selection.source).toBe("layer");
    expect(selectPipeLayerSystem({ ...linework, truncated: true }, "SAN").truncated).toBe(true);
  });
  it("identifies unlabelled CAD pipes and ignores an architectural line closer to the tap", () => {
    const drawing = index([
      line("pipe", 0.1, 0.5, 0.8, 0.5, { layer: "M-PLMB-SANI" }),
      line("background", 0.1, 0.501, 0.8, 0.501, { layer: "A201|A-GLAZ", stroke: "#757575" }),
      line("tag", 0.1, 0.502, 0.12, 0.502, { layer: "M-NOTE" }),
    ]);
    const selection = selectPipeSystem(drawing, { x: 0.3, y: 0.501 }, 0.003);
    expect(selection.system).toBe("SAN");
    expect(ids(selection)).toEqual(["pipe"]);
    expect(selectPipeSystem(drawing, { x: 0.3, y: 0.501 }, 0.0001).segments).toHaveLength(0);
  });

  it("binds rotated text to the pipe instead of tiny symbols or grey background", () => {
    const drawing = index([
      line("pipe", 0.2, 0.4, 0.4, 0.46, { layer: "M-PLMB-DHWR", stroke: "#000000" }),
      line("symbol", 0.3, 0.423, 0.30002, 0.423, { layer: "M-PLMB-MISC", width: 0, closed: true }),
      line("background", 0.28, 0.423, 0.33, 0.423, { layer: "A201|A-GLAZ", stroke: "#757575" }),
    ], [{ ...label("DHWR", 0.3, 0.423, 0.03, 0.017), direction: { x: 0.2, y: 0.06 } }]);
    expect(drawing.bindings[0]?.segments).toEqual([0]);
    expect(ids(selectPipeSystem(drawing, { x: 0.3, y: 0.423 }, 0.001))).toEqual(["pipe"]);
    const tag = index([line("wall", 0.1, 0.5, 0.3, 0.5, { layer: "A201|A-FIXT" })], [label("PD", 0.2, 0.49)]);
    expect(tag.bindings[0]?.segments).toEqual([]);
  });

  it("bridges irregular CAD dashes with rounding error, while preserving a parallel lane", () => {
    const parts = [
      line("a", 0.1, 0.5, 0.105, 0.5015),
      line("b", 0.107, 0.50213, 0.117, 0.50513),
      line("c", 0.119, 0.50570, 0.124, 0.50720),
      line("other-lane", 0.107, 0.50263, 0.117, 0.50563),
    ].map(segment => ({ ...segment, layer: "M-PLMB-DHWR", width: 0.000313 }));
    for (const segment of parts.slice(0, 3)) {
      const selection = selectPipeSystem(index(parts), { x: (segment.x1 + segment.x2) / 2, y: (segment.y1 + segment.y2) / 2 }, 0.00001);
      expect(selection.system).toBe("DHWR");
      expect(ids(selection)).toEqual(["a", "b", "c"]);
      expect(selection.segments.filter(part => part.id.startsWith("pipe-bridge:"))).toHaveLength(2);
    }
  });

  it("selects the whole trunk and T branches from either the trunk or branch", () => {
    const drawing = index([
      line("trunk", 0.1, 0.5, 0.9, 0.5),
      line("branch", 0.35, 0.5, 0.35, 0.7),
      line("elbow", 0.35, 0.7, 0.55, 0.7),
      line("branch2", 0.8, 0.2, 0.8, 0.5),
    ], [label("ST", 0.2, 0.485)]);
    for (const point of [{ x: 0.7, y: 0.5 }, { x: 0.35, y: 0.6 }, { x: 0.2, y: 0.485 }]) {
      const selection = selectPipeSystem(drawing, point, 0.005);
      expect(selection.system).toBe("ST");
      expect(ids(selection)).toEqual(["branch", "branch2", "elbow", "trunk"]);
      expect(selection.lengthInSheetWidths).toBeCloseTo(1.5);
      expect(selection.truncated).toBe(false);
    }
  });

  it("keeps an interior crossing, nearby parallel pipe, and detached same-code system separate", () => {
    const drawing = index([
      line("ST", 0.1, 0.4, 0.8, 0.4),
      line("crossing", 0.5, 0.1, 0.5, 0.7),
      line("parallel", 0.1, 0.4001, 0.8, 0.4001),
      line("detached", 0.1, 0.8, 0.4, 0.8),
    ], [label("ST", 0.2, 0.385), label("SAN", 0.5, 0.16, 0.008, 0.025), label("ST", 0.2, 0.785)]);
    const selection = selectPipeSystem(drawing, { x: 0.3, y: 0.4 }, 0.001);
    expect(ids(selection)).toEqual(["ST"]);
    expect(selection.lengthInSheetWidths).toBeCloseTo(0.7);
  });

  it("stops at explicitly conflicting system labels even when styles match", () => {
    const drawing = index([
      line("storm", 0.1, 0.5, 0.5, 0.5),
      line("sanitary", 0.5, 0.5, 0.8, 0.5),
      line("sanitaryBranch", 0.7, 0.5, 0.7, 0.8),
    ], [label("ST", 0.2, 0.485), label("SAN", 0.65, 0.485)]);
    const selection = selectPipeSystem(drawing, { x: 0.2, y: 0.5 }, 0.003);
    expect(ids(selection)).toEqual(["storm"]);
    expect(selection.warnings.some((warning) => warning.includes("different system"))).toBe(true);
    expect(selectPipeSystem(drawing, { x: 0.65, y: 0.5 }, 0.003, "ST").segments).toHaveLength(0);
  });

  it("bridges a bounded inline label interruption and counts its span", () => {
    const drawing = index([
      line("left", 0.1, 0.5, 0.48, 0.5),
      line("right", 0.52, 0.5, 0.9, 0.5),
    ], [label("ST", 0.5, 0.5, 0.04, 0.015)]);
    const selection = selectPipeSystem(drawing, { x: 0.5, y: 0.5 }, 0.003);
    expect(ids(selection)).toEqual(["left", "right"]);
    expect(selection.segments.some((segment) => segment.id.startsWith("pipe-bridge:"))).toBe(true);
    expect(selection.lengthInSheetWidths).toBeCloseTo(0.8);
    expect(selection.warnings.some((warning) => warning.includes("gaps"))).toBe(true);
  });

  it("bridges declared and regular manually expanded dashes without bridging arbitrary breaks", () => {
    const drawing = index([
      line("d1", 0.1, 0.3, 0.11, 0.3),
      line("d2", 0.114, 0.3, 0.124, 0.3),
      line("d3", 0.128, 0.3, 0.138, 0.3),
      line("d4", 0.142, 0.3, 0.152, 0.3),
      line("far", 0.19, 0.3, 0.2, 0.3),
      line("solid1", 0.1, 0.7, 0.3, 0.7),
      line("solid2", 0.31, 0.7, 0.5, 0.7),
    ], [label("ST", 0.105, 0.29, 0.01)]);
    const selection = selectPipeSystem(drawing, { x: 0.105, y: 0.3 }, 0.001);
    expect(ids(selection)).toEqual(["d1", "d2", "d3", "d4"]);
    expect(selection.lengthInSheetWidths).toBeCloseTo(0.052);
    expect(ids(selectPipeSystem(drawing, { x: 0.15, y: 0.7 }, 0.001))).toEqual(["solid1"]);
    const declared = index([
      line("d1", 0.1, 0.5, 0.12, 0.5, { dash: [0.02, 0.008] }),
      line("d2", 0.128, 0.5, 0.148, 0.5, { dash: [0.02, 0.008] }),
    ]);
    expect(selectPipeSystem(declared, { x: 0.11, y: 0.5 }, 0.001).lengthInSheetWidths).toBeCloseTo(0.048);
  });

  it("traces the same manually expanded CAD dash system from every fragment", () => {
    const parts = [line("A", 0.1, 0.5, 0.12, 0.5), line("B", 0.13, 0.5, 0.15, 0.5), line("C", 0.16, 0.5, 0.18, 0.5)];
    for (const points of [[0.11, 0.14, 0.17], [0.17, 0.14, 0.11]]) {
      const drawing = index(parts, [label("ST", 0.11, 0.489)]);
      for (const x of points) {
        const selection = selectPipeSystem(drawing, { x, y: 0.5 }, 0.0001);
        expect(selection.system).toBe("ST");
        expect(ids(selection)).toEqual(["A", "B", "C"]);
        expect(selection.lengthInSheetWidths).toBeCloseTo(0.08);
        expect(selection.truncated).toBe(false);
      }
    }
  });

  it("does not inherit a label from a nearby parallel lane or distant legend", () => {
    const drawing = index([
      line("pipe", 0.1, 0.5, 0.9, 0.5),
      line("parallel", 0.1, 0.52, 0.9, 0.52),
    ], [label("ST", 0.2, 0.49), label("SAN", 0.85, 0.3)]);
    expect(selectPipeSystem(drawing, { x: 0.5, y: 0.5 }, 0.001).system).toBe("ST");
    expect(selectPipeSystem(drawing, { x: 0.5, y: 0.52 }, 0.001).system).toBeNull();
    expect(selectPipeSystem(drawing, { x: 0.85, y: 0.3 }, 0.001).segments).toHaveLength(0);
  });

  it("filters wall styles and unrelated layers at a shared endpoint", () => {
    const drawing = index([
      line("pipe", 0.1, 0.5, 0.5, 0.5, { layer: "P-ST" }),
      line("wall", 0.5, 0.5, 0.5, 0.8, { width: 0.003 }),
      line("lightWall", 0.5, 0.5, 0.8, 0.5, { stroke: "#cccccc" }),
      line("differentLayer", 0.5, 0.5, 0.5, 0.2, { layer: "A-WALL" }),
    ], [label("ST", 0.2, 0.485)]);
    expect(ids(selectPipeSystem(drawing, { x: 0.3, y: 0.5 }, 0.001))).toEqual(["pipe"]);
  });

  it("joins a confirmed same-system T branch across a pipe width change", () => {
    const drawing = index([
      line("trunk", 0.1, 0.5, 0.8, 0.5),
      line("ST-branch", 0.4, 0.2, 0.4, 0.5, { width: 0.002 }),
      line("unknown-wide-line", 0.6, 0.5, 0.6, 0.8, { width: 0.003 }),
      line("SAN-branch", 0.7, 0.2, 0.7, 0.5, { width: 0.002 }),
      line("crossing", 0.5, 0.1, 0.5, 0.8, { width: 0.002 }),
    ], [label("ST", 0.2, 0.489), label("ST", 0.412, 0.3), label("SAN", 0.712, 0.3), label("ST", 0.512, 0.15)]);
    const selection = selectPipeSystem(drawing, { x: 0.2, y: 0.5 }, 0.001);
    expect(ids(selection)).toEqual(["ST-branch", "trunk"]);
    expect(selection.lengthInSheetWidths).toBeCloseTo(1);
    expect(selection.truncated).toBe(false);
  });

  it("joins exact adjoining curve subdivisions without joining nearby parallel lanes", () => {
    const drawing = index([
      line("curve-1", 0.1, 0.4, 0.2, 0.4, { pathId: "curve" }),
      line("curve-2", 0.2, 0.4, 0.3, 0.402, { pathId: "curve" }),
      line("curve-3", 0.3, 0.402, 0.4, 0.406, { pathId: "curve" }),
      line("nearby", 0.1, 0.4001, 0.2, 0.4001),
    ]);
    const selection = selectPipeSystem(drawing, { x: 0.15, y: 0.4 }, 0.00001);
    expect(ids(selection)).toEqual(["curve-1", "curve-2", "curve-3"]);
    expect(selection.lengthInSheetWidths).toBeCloseTo(0.1 + Math.hypot(0.1, 0.002) + Math.hypot(0.1, 0.004));
  });

  it("excludes unlabeled closed rectangles but retains explicitly tagged pipe loops", () => {
    const loop = [
      line("top", 0.2, 0.2, 0.6, 0.2, { pathId: "rectangle", closed: true }),
      line("right", 0.6, 0.2, 0.6, 0.6, { pathId: "rectangle", closed: true }),
      line("bottom", 0.6, 0.6, 0.2, 0.6, { pathId: "rectangle", closed: true }),
      line("left", 0.2, 0.6, 0.2, 0.2, { pathId: "rectangle", closed: true }),
    ];
    expect(selectPipeSystem(index(loop), { x: 0.4, y: 0.2 }, 0.001).segments).toHaveLength(0);
    const selection = selectPipeSystem(index(loop, [label("ST", 0.4, 0.19)]), { x: 0.4, y: 0.2 }, 0.001);
    expect(ids(selection)).toEqual(["bottom", "left", "right", "top"]);
    expect(selection.lengthInSheetWidths).toBeCloseTo(1.6);
  });

  it("deduplicates reversed and partly overlapping strokes; cycles terminate", () => {
    const drawing = index([
      line("a", 0.1, 0.2, 0.5, 0.2),
      line("duplicate", 0.5, 0.2, 0.1, 0.2),
      line("overlap", 0.3, 0.2, 0.7, 0.2),
      line("b", 0.7, 0.2, 0.7, 0.5),
      line("c", 0.7, 0.5, 0.1, 0.5),
      line("d", 0.1, 0.5, 0.1, 0.2),
    ]);
    const selection = selectPipeSystem(drawing, { x: 0.2, y: 0.2 }, 0.001);
    expect(selection.segments).toHaveLength(6);
    expect(selection.lengthInSheetWidths).toBeCloseTo(1.8);
  });

  it("uses physical sheet aspect for lengths and fixed graph joins across tap tolerances", () => {
    const drawing = index([
      line("horizontal", 0.1, 0.3, 0.4, 0.3),
      line("vertical", 0.4, 0.3, 0.4, 0.5),
      line("nearby", 0.401, 0.5, 0.401, 0.7),
    ], [], { aspect: 2 });
    const narrow = selectPipeSystem(drawing, { x: 0.2, y: 0.3 }, 0.001);
    const wide = selectPipeSystem(drawing, { x: 0.2, y: 0.3 }, 0.03);
    expect(ids(narrow)).toEqual(["horizontal", "vertical"]);
    expect(ids(wide)).toEqual(ids(narrow));
    expect(narrow.lengthInSheetWidths).toBeCloseTo(0.7);
  });

  it("rejects malformed, zero, and out-of-page geometry and invalid taps", () => {
    const drawing = index([
      line("valid", 0.1, 0.5, 0.3, 0.5),
      line("zero", 0.2, 0.2, 0.2, 0.2),
      line("nan", NaN, 0.5, 0.8, 0.5),
      line("outside", 0.8, 0.5, 1.01, 0.5),
    ]);
    expect(drawing.segments).toHaveLength(1);
    expect(drawing.linework.segments).toBe(drawing.segments);
    expect(selectPipeSystem(drawing, { x: NaN, y: 0.5 }, 0.01).segments).toHaveLength(0);
    expect(selectPipeSystem(drawing, { x: 0.2, y: 0.5 }, Infinity).segments).toHaveLength(0);
    expect(buildPipeSystemIndex({ segments: drawing.segments, labels: [], aspect: NaN, truncated: false }).segments).toHaveLength(0);
    const complexDash = index([
      line("accepted", 0.1, 0.5, 0.3, 0.5, { dash: Array.from({ length: 64 }, () => 0.001) }),
      line("over-limit", 0.1, 0.7, 0.3, 0.7, { dash: Array.from({ length: 65 }, () => 0.001) }),
    ]);
    expect(complexDash.segments.map((segment) => segment.id)).toEqual(["accepted"]);
  });

  it("marks extracted or indexed caps as partial and does not manufacture physical units", () => {
    const drawing = index([line("pipe", 0.1, 0.5, 0.3, 0.5)], [], { truncated: true });
    const selection = selectPipeSystem(drawing, { x: 0.2, y: 0.5 }, 0.001);
    expect(selection.truncated).toBe(true);
    expect(selection.warnings.some((warning) => warning.includes("partial"))).toBe(true);
    expect(selection.lengthInSheetWidths).toBeCloseTo(0.2);
    expect(selection).not.toHaveProperty("meters");
    const dense = index(Array.from({ length: 1_000 }, (_, i) => line(`tiny-${i}`, 0.1001 + i * 1e-7, 0.1, 0.1002 + i * 1e-7, 0.1)));
    expect(selectPipeSystem(dense, { x: 0.10015, y: 0.1 }, 0.001).truncated).toBe(true);
  });

  it("builds a large sparse page with bounded spatial cells instead of segment pairs", () => {
    const segments: PipeSegment[] = [];
    for (let y = 0; y < 400; y++) {
      for (let x = 0; x < 500; x++) {
        segments.push(line(`${x}-${y}`, 0.001 + x / 500, 0.001 + y / 400, 0.0015 + x / 500, 0.001 + y / 400));
      }
    }
    const started = performance.now();
    const drawing = index(segments);
    expect(drawing.segments).toHaveLength(200_000);
    expect(drawing.buckets.size).toBeLessThan(3_000);
    expect(drawing.truncated).toBe(false);
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  it("preserves late pipe strokes when gray architecture fills a cell or tap query", () => {
    const gray = Array.from({ length: 6_000 }, (_, i) => line(`wall-${i}`, 0.4 + (i % 500) * 0.000001, 0.495 + Math.floor(i / 500) * 0.0005, 0.405 + (i % 500) * 0.000001, 0.495 + Math.floor(i / 500) * 0.0005, { stroke: "#777777", width: 0.0001 }));
    const drawing = index([
      ...gray,
      line("ST", 0.3, 0.5, 0.7, 0.5),
      line("branch", 0.6, 0.5, 0.6, 0.8),
    ], [label("ST", 0.65, 0.489)]);
    const selection = selectPipeSystem(drawing, { x: 0.4, y: 0.5 }, 0.0001);
    expect(ids(selection)).toEqual(["ST", "branch"]);
    expect(selection.system).toBe("ST");
    expect(selection.lengthInSheetWidths).toBeCloseTo(0.7);
    expect(selection.truncated).toBe(false);
    expect(selectPipeSystem(drawing, { x: 0.402, y: 0.495 }, 0.0001).truncated).toBe(true);
    expect(selectPipeSystem(drawing, { x: 0.4, y: 0.5 }, 0.0001).truncated).toBe(false);
  });

  it("does not carry a previous run's complexity limit into an unrelated simple run", () => {
    const complex = Array.from({ length: 8_200 }, (_, i) => line(`crowded-${i}`, 0.1 + (i % 100) * 0.000002, 0.1 + Math.floor(i / 100) * 0.000002, 0.101 + (i % 100) * 0.000002, 0.1 + Math.floor(i / 100) * 0.000002));
    const drawing = index([...complex, line("simple", 0.7, 0.7, 0.9, 0.7)]);
    expect(selectPipeSystem(drawing, { x: 0.1005, y: 0.1 }, 0.00001).truncated).toBe(true);
    const simple = selectPipeSystem(drawing, { x: 0.8, y: 0.7 }, 0.00001);
    expect(ids(simple)).toEqual(["simple"]);
    expect(simple.lengthInSheetWidths).toBeCloseTo(0.2);
    expect(simple.truncated).toBe(false);
    expect(simple.warnings.some((warning) => warning.includes("partial"))).toBe(false);
  });
});
