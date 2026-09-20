import { describe, expect, it } from "vitest";
import { extractPdfLinework } from "./pdf-walls";
import { buildFloorGraph } from "./floor-graph";
import { buildWallLinework, referenceStrokeWidth } from "./wall-lines";
import { supportedRoomBoundary } from "./supplementary-rooms";

// Real PDF streams exercise PDF.js operator normalization, not a mocked parser.
function pdf(content: string, resources = "", extra: string[] = []) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 1000] /Resources << ${resources} >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    ...extra,
  ];
  let result = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(result));
    result += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    result += `${String(offset).padStart(10, "0")} 00000 n \n`;
  result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(result);
}
const extract = (content: string) => extractPdfLinework(pdf(content), 1);
const pools = (result: Awaited<ReturnType<typeof extract>>) => [
  result.segments,
  result.supplementarySegments!,
];

describe("PDF non-solid wall policy", () => {
  it.each(["[12 6]", "[0 6]", "[12 6 0 6]"])(
    "rejects %s before either wall pool or fallback",
    async (pattern) => {
      const result = await extract(`2 w 1 J ${pattern} 3 d 200 200 50 50 re S`);
      for (const pool of pools(result)) expect(pool).toEqual([]);
      expect(result.arcs).toEqual([]);
      expect(buildFloorGraph(result).faces).toEqual([]);
      expect(buildWallLinework(result.segments, { mode: "all" }).lines).toEqual(
        [],
      );
    },
  );
  it("resets to solid and restores nested saved dash states", async () => {
    const result = await extract(
      `2 w [] 0 d q [10 5] 0 d 200 200 50 50 re S q [] 0 d 300 300 50 50 re S Q 400 400 50 50 re S Q 500 500 50 50 re S`,
    );
    for (const pool of pools(result)) {
      expect(pool).toHaveLength(8);
      expect(pool.every((s) => !s.dashed)).toBe(true);
      expect(pool.every((s) => s.x1 >= 0.3 && s.x1 <= 0.55)).toBe(true);
    }
  });
  it.each(["f", "f*", "B", "B*", "b", "b*"])(
    "preserves solid fill independently of dashed stroke for %s",
    async (paint) => {
      const result = await extract(`[0 5] 0 d 200 200 50 50 re ${paint}`);
      for (const pool of pools(result)) {
        expect(pool).toHaveLength(4);
        expect(pool.every((s) => s.filled && !s.dashed)).toBe(true);
      }
    },
  );
  it("does not promote a dashed outline of a background fill", async () => {
    for (const pool of pools(await extract(`[10 5] 0 d 200 200 300 300 re B`)))
      expect(pool).toEqual([]);
  });
  it("reads ExtGState dash and width, with Q restoring them", async () => {
    const result = await extractPdfLinework(
      pdf(
        "2 w q /GS gs 200 200 50 50 re S Q 400 400 50 50 re S",
        "/ExtGState << /GS 5 0 R >>",
        ["<< /Type /ExtGState /D [[0 6] 0] /LW 99 >>"],
      ),
      1,
    );
    for (const pool of pools(result)) {
      expect(pool).toHaveLength(4);
      expect(pool.every((s) => s.strokeWidth === 2 && !s.dashed)).toBe(true);
    }
  });
  it("restores form-local dash state without contaminating subsequent solid walls", async () => {
    const form = "[10 5] 0 d 200 200 50 50 re S";
    const result = await extractPdfLinework(
      pdf("2 w /Form Do 400 400 50 50 re S", "/XObject << /Form 5 0 R >>", [
        `<< /Type /XObject /Subtype /Form /BBox [0 0 1000 1000] /Resources << >> /Length ${form.length} >>\nstream\n${form}\nendstream`,
      ]),
      1,
    );
    for (const pool of pools(result)) expect(pool).toHaveLength(4);
  });
  it("keeps legitimate short solid returns", async () => {
    expect(
      (await extract("2 w 200 200 m 202 200 l S")).supplementarySegments,
    ).toHaveLength(1);
  });
  it("does not let thousands of dashed strokes consume the solid wall budget", async () => {
    const result = await extract(
      `[10 5] 0 d ${"200 200 m 250 200 l S\n".repeat(4100)} [] 0 d 400 400 50 50 re S`,
    );
    for (const pool of pools(result)) expect(pool).toHaveLength(4);
  });
});

describe("direct wall evidence callers", () => {
  const shape = {
    type: "polygon" as const,
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.25, y: 0.2 },
      { x: 0.25, y: 0.25 },
      { x: 0.2, y: 0.25 },
    ],
  };
  const solid = shape.points.map((p, i) => ({
    x1: p.x,
    y1: p.y,
    x2: shape.points[(i + 1) % 4]!.x,
    y2: shape.points[(i + 1) % 4]!.y,
    strokeWidth: 2,
  }));
  const dashed = solid.map((s) => ({ ...s, dashed: true, strokeWidth: 1000 }));
  it("excludes non-solid input from grading, all-mode and weak-evidence fallback", () => {
    expect(referenceStrokeWidth([...solid, ...dashed, ...dashed])).toBe(2);
    expect(buildFloorGraph(dashed).faces).toEqual([]);
    expect(buildFloorGraph(dashed, { mode: "all" }).faces).toEqual([]);
    expect(buildWallLinework(dashed, { mode: "all" }).lines).toEqual([]);
  });
  it("cannot validate a boundary supported only by dashed strokes", () => {
    expect(supportedRoomBoundary(shape, solid, [])).toBe(true);
    expect(supportedRoomBoundary(shape, dashed, [])).toBe(false);
  });
});
