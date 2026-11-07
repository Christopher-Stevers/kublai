import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPaintedPage, LIMITS, parseOperatorList } from "./painted-paths";
import type { OperatorListInput } from "./schema";

const sha = "a".repeat(64);
type Op = [number, unknown[] | null];
function parse(ops: Op[], extra: Partial<OperatorListInput> = {}) {
  return parseOperatorList({
    sourceSha256: sha,
    pageIndex: 0,
    width: 200,
    height: 200,
    viewportTransform: [1, 0, 0, -1, 0, 200],
    fnArray: ops.map((x) => x[0]),
    argsArray: ops.map((x) => x[1]),
    ...extra,
  });
}
function stroke(data: number[]): Op {
  return [
    OPS.constructPath,
    [OPS.stroke, [Float32Array.from(data)], [10, 10, 190, 190]],
  ];
}
const line = () => stroke([0, 20, 30, 1, 70, 30]);
function pdf(content: string, pageExtra = ""): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] ${pageExtra} /Resources << >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let text = "%PDF-1.7\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(text));
    text += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const start = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    text += `${String(offset).padStart(10, "0")} 00000 n \n`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(text));
}

test("v6 normalized packed stream preserves native commands and isotropic viewport metric", () => {
  const p = parse([line()]);
  assert.deepEqual(p.lines[0]!.a, { x: 20, y: 170 });
  assert.deepEqual(p.lines[0]!.b, { x: 70, y: 170 });
  assert.equal(p.lines[0]!.eligible, true);
  assert.equal(p.paths[0]!.rawConstructPath![0], OPS.stroke);
  assert.deepEqual(p.paths[0]!.commands[1]!.nativeOperands, [70, 30]);
  const rotated = parse([line()], { viewportTransform: [0, 1, 1, 0, 0, 0] });
  assert.deepEqual(rotated.lines[0]!.a, { x: 30, y: 20 });
  assert.equal(
    Math.hypot(
      rotated.lines[0]!.b.x - rotated.lines[0]!.a.x,
      rotated.lines[0]!.b.y - rotated.lines[0]!.a.y,
    ),
    50,
  );
});
test("full cubic controls are preserved and adaptively sampled without circularity claims", () => {
  const p = parse([
    stroke([0, 100, 140, 2, 122.09139, 140, 140, 122.09139, 140, 100]),
  ]);
  const c = p.paths[0]!.commands[1]!;
  assert.equal(c.kind, "cubic");
  assert.equal(c.points.length, 4);
  assert.equal(c.nativeOperands.length, 6);
  const a = p.arcs[0]!;
  assert.deepEqual(a.points[0], { x: 100, y: 60 });
  assert.deepEqual(a.points.at(-1), { x: 140, y: 100 });
  assert.ok(a.points.length > 8);
  assert.equal(a.eligible, true);
  assert.equal("radius" in a, false);
  assert.equal("portal" in a, false);
  assert.equal(p.lines.length, 0);
});
test("quadratic, short cubics and closed paths retain full segment geometry", () => {
  const p = parse([
    stroke([0, 20, 20, 3, 40, 80, 80, 20]),
    [OPS.moveTo, [40, 40]],
    [OPS.curveTo2, [50, 70, 80, 40]],
    [OPS.curveTo3, [90, 30, 100, 40]],
    [OPS.closePath, []],
    [OPS.stroke, []],
  ]);
  assert.equal(p.paths[0]!.commands[1]!.kind, "quadratic");
  assert.equal(p.arcs.length, 3);
  assert.equal(p.lines.length, 1);
  assert.deepEqual(
    p.paths[1]!.commands[1]!.points[0],
    p.paths[1]!.commands[1]!.points[1],
  );
  assert.deepEqual(
    p.paths[1]!.commands[2]!.points[2],
    p.paths[1]!.commands[2]!.points[3],
  );
  assert.deepEqual(p.lines[0]!.b, { x: 40, y: 160 });
});
test("save/restore and nested form transforms restore exact state and bounded clips", () => {
  const p = parse([
    [OPS.save, []],
    [OPS.transform, [2, 0, 0, 2, 10, 10]],
    [OPS.setLineWidth, [0.5]],
    [
      OPS.paintFormXObjectBegin,
      [
        [1, 0, 0, 1, 5, 5],
        [0, 0, 80, 80],
      ],
    ],
    line(),
    [OPS.paintFormXObjectEnd, []],
    [OPS.restore, []],
    line(),
  ]);
  assert.deepEqual(p.lines[0]!.a, { x: 60, y: 120 });
  assert.deepEqual(p.lines[1]!.a, { x: 20, y: 170 });
  assert.equal(p.lines[0]!.eligible, true);
  assert.equal(p.paths[0]!.formOperators.length, 1);
  assert.equal(p.paths[0]!.graphicsState.clips.length, 2);
  assert.equal(p.paths[1]!.graphicsState.clips.length, 1);
  assert.ok(
    p.diagnostics.graphicsOperations.some(
      (x) => x.operator === "paintFormXObjectBegin",
    ),
  );
});
test("contained rectangular clips pass while crossing/curved/even-odd clips remain ineligible", () => {
  const rect: Op[] = [
    [OPS.rectangle, [10, 10, 100, 100]],
    [OPS.clip, []],
    [OPS.endPath, []],
  ];
  const p = parse([...rect, line(), stroke([0, 20, 30, 1, 150, 30])]);
  assert.equal(p.lines[0]!.eligible, true);
  assert.ok(p.lines[1]!.reasons.includes("clip-containment-unproved"));
  const curved = parse([
    [OPS.moveTo, [10, 10]],
    [OPS.curveTo, [20, 30, 40, 30, 50, 10]],
    [OPS.clip, []],
    [OPS.endPath, []],
    line(),
  ]);
  assert.ok(curved.lines[0]!.reasons.includes("unsupported-clip"));
  const eo = parse([
    [OPS.rectangle, [10, 10, 100, 100]],
    [OPS.eoClip, []],
    [OPS.endPath, []],
    line(),
  ]);
  assert.ok(eo.lines[0]!.reasons.includes("unsupported-clip"));
});
test("form bbox containment accounts for stroke footprint and rotated unsupported bbox", () => {
  const p = parse([
    [OPS.paintFormXObjectBegin, [null, [20, 20, 70, 40]]],
    line(),
    [OPS.paintFormXObjectEnd, []],
  ]);
  assert.ok(p.lines[0]!.reasons.includes("clip-containment-unproved"));
  const q = Math.SQRT1_2;
  const r = parse([
    [
      OPS.paintFormXObjectBegin,
      [
        [q, q, -q, q, 100, 0],
        [0, 0, 100, 100],
      ],
    ],
    line(),
    [OPS.paintFormXObjectEnd, []],
  ]);
  assert.ok(r.lines[0]!.reasons.includes("unsupported-clip"));
});
test("self-crossing/reordered clip corners cannot be certified as an exact rectangle", () => {
  for (const corners of [
    [
      [10, 10],
      [110, 110],
      [10, 110],
      [110, 10],
    ],
    [
      [10, 10],
      [110, 10],
      [10, 110],
      [110, 110],
    ],
  ]) {
    const ops: Op[] = [
      [OPS.moveTo, corners[0]!],
      ...corners.slice(1).map((p) => [OPS.lineTo, p] as Op),
      [OPS.closePath, []],
      [OPS.clip, []],
      [OPS.endPath, []],
      line(),
    ];
    const p = parse(ops);
    assert.equal(p.lines[0]!.eligible, false);
    assert.ok(p.lines[0]!.reasons.includes("unsupported-clip"));
    assert.equal(p.paths[1]!.graphicsState.clips.length, 1);
  }
});
test("nonuniform and sheared CTMs preserve geometry but cannot become eligible evidence", () => {
  for (const m of [
    [2, 0, 0, 1, 0, 0],
    [1, 0, 0.2, 1, 0, 0],
  ]) {
    const p = parse([[OPS.transform, m], line()]);
    assert.ok(p.lines[0]!.reasons.includes("nonuniform-or-sheared-ctm"));
    assert.equal(p.paths[0]!.graphicsState.ctm[0], m[0]);
  }
  assert.throws(
    () => parse([line()], { viewportTransform: [2, 0, 0, 1, 0, 0] }),
    /viewport is not isotropic/,
  );
});
test("color, alpha, blend, soft mask, dash and optional-content states fail closed", () => {
  const styles: Op[][] = [
    [[OPS.setStrokeRGBColor, ["#ff0000"]]],
    [[OPS.setStrokeTransparent, []]],
    [[OPS.setStrokeColorN, ["pattern"]]],
    [[OPS.setGState, [[["CA", 0.5]]]]],
    [[OPS.setGState, [[["BM", "multiply"]]]]],
    [[OPS.setGState, [[["SMask", true]]]]],
    [[OPS.setGState, [[["TR", [1, 2]]]]]],
    [[OPS.setDash, [[2, 2], 0]]],
    [
      [
        OPS.beginMarkedContentProps,
        ["OC", { id: "layer-hidden-or-unresolved" }],
      ],
    ],
    [[OPS.setGState, [[["OP", true]]]]],
  ];
  for (const ops of styles) {
    const oc = ops[0]![0] === OPS.beginMarkedContentProps;
    const p = parse([
      ...ops,
      line(),
      ...(oc ? [[OPS.endMarkedContent, []] as Op] : []),
    ]);
    assert.equal(p.lines[0]!.eligible, false);
    assert.ok(p.lines[0]!.reasons.length);
  }
  const p = parse([[OPS.setStrokeGray, [0.7]], line()]);
  assert.equal(p.lines[0]!.eligible, true);
});
test("fill-only and filled-stroke geometry stays preserved without certifying visible lines", () => {
  const packed = [0, 20, 20, 1, 80, 20, 1, 80, 80, 4];
  const p = parse([
    [OPS.constructPath, [OPS.fill, [packed], [20, 20, 80, 80]]],
    [OPS.constructPath, [OPS.fillStroke, [packed], [20, 20, 80, 80]]],
  ]);
  assert.equal(p.paths.length, 2);
  assert.equal(p.paths[0]!.eligible, false);
  assert.equal(p.lines.length, 3);
  assert.ok(
    p.lines.every(
      (x) => !x.eligible && x.reasons.includes("filled-stroke-path"),
    ),
  );
});
test("empty paths and degenerate curves are retained conservatively", () => {
  const p = parse([
    [OPS.constructPath, [OPS.endPath, [null], null]],
    stroke([0, 20, 20, 2, 20, 20, 20, 20, 20, 20]),
  ]);
  assert.equal(p.paths.length, 2);
  assert.equal(p.arcs[0]!.eligible, false);
  assert.ok(p.arcs[0]!.reasons.includes("degenerate-curve"));
});
test("malformed paths, old construct representation and nonfinite state fail atomically", () => {
  const bad: Op[][] = [
    [
      [
        OPS.constructPath,
        [
          [OPS.moveTo, OPS.lineTo],
          [20, 20, 80, 20],
          [20, 20, 80, 20],
        ],
      ],
    ],
    [stroke([0, 20, 20, 2, 20, 30])],
    [stroke([9, 20, 20])],
    [[OPS.transform, [1, 0, 0, 1, NaN, 0]], line()],
    [[OPS.setGState, [[["CA", 2]]]], line()],
    [[OPS.restore, []]],
    [[OPS.save, []], line()],
    [[OPS.moveTo, [10, 20]]],
    [[OPS.closePath, []]],
    [[OPS.endMarkedContent, []]],
    [[OPS.setLineWidth, [-1]], line()],
  ];
  for (const ops of bad) assert.throws(() => parse(ops), /painted-paths:/);
  assert.throws(
    () => parse([line()], { pdfjsVersion: "5.0.0" }),
    /version mismatch/,
  );
});
test("outer operator budget rejects before reading any arguments", () => {
  const args = {
    length: LIMITS.maxOperators + 1,
    get 0() {
      throw new Error("arguments inspected");
    },
  };
  assert.throws(
    () =>
      parseOperatorList({
        sourceSha256: sha,
        pageIndex: 0,
        width: 200,
        height: 200,
        viewportTransform: [1, 0, 0, -1, 0, 200],
        fnArray: { length: LIMITS.maxOperators + 1 },
        argsArray: args,
      }),
    /operator count/,
  );
});
test("repeat output is stable and input/operator/state snapshots are not mutated", () => {
  const ops: Op[] = [
    [
      OPS.setGState,
      [
        [
          ["CA", 1],
          ["D", [[1, 2], 0]],
        ],
      ],
    ],
    line(),
  ];
  const before = structuredClone(ops);
  const a = parse(ops),
    b = parse(ops);
  assert.deepEqual(a, b);
  assert.deepEqual(ops, before);
  a.paths[0]!.graphicsState.dash[0] = 77;
  assert.notEqual(b.paths[0]!.graphicsState.dash[0], 77);
});
test("small native curves retain at least nine exact adaptive samples", () => {
  const p = parse([
    stroke([0, 100, 102, 2, 101.1045695, 102, 102, 101.1045695, 102, 100]),
  ]);
  assert.ok(p.arcs[0]!.points.length >= 9);
  assert.equal(p.arcs[0]!.representation, "native-curve");
});
test("flattened quarter preserves original contiguous vertices and original lines", () => {
  const data = [0, 100, 140];
  for (let k = 1; k <= 20; k++) {
    const a = ((Math.PI / 2) * k) / 20;
    data.push(1, 100 + 40 * Math.sin(a), 100 + 40 * Math.cos(a));
  }
  const p = parse([stroke(data)]);
  assert.equal(p.lines.length, 20);
  assert.equal(p.arcs.length, 1);
  const a = p.arcs[0]!;
  assert.equal(a.representation, "contiguous-line-run");
  assert.equal(a.points.length, 21);
  assert.equal(a.sourceCommandIndices!.length, 20);
  assert.deepEqual(a.points, [
    p.paths[0]!.commands[1]!.points[0]!,
    ...p.paths[0]!.commands.slice(1).map((c) => c.points[1]!),
  ]);
  assert.equal(a.eligible, true);
});
test("dotted/disconnected line fragments cannot be gap joined or interpolated into arcs", () => {
  const data: number[] = [];
  for (let k = 0; k < 20; k++) {
    const a = ((Math.PI / 2) * k) / 20,
      b = a + 0.02;
    data.push(
      0,
      100 + 40 * Math.sin(a),
      100 + 40 * Math.cos(a),
      1,
      100 + 40 * Math.sin(b),
      100 + 40 * Math.cos(b),
    );
  }
  const p = parse([stroke(data)]);
  assert.equal(p.lines.length, 20);
  assert.equal(p.arcs.length, 0);
});
test("later fill overlap invalidates earlier witnesses; background first and distant fill preserve them", () => {
  const fill: Op = [
    OPS.constructPath,
    [
      OPS.fill,
      [[0, 10, 10, 1, 90, 10, 1, 90, 50, 1, 10, 50, 4]],
      [10, 10, 90, 50],
    ],
  ];
  const covered = parse([line(), [OPS.setFillRGBColor, ["#ffffff"]], fill]);
  assert.equal(covered.lines[0]!.eligible, false);
  assert.ok(
    covered.lines[0]!.reasons.includes("later-fill-occlusion-unresolved"),
  );
  assert.equal(
    covered.diagnostics.occlusionOperations.at(-1)!.affectedEvidence,
    1,
  );
  const prior = parse([[OPS.setFillRGBColor, ["#ffffff"]], fill, line()]);
  assert.equal(prior.lines[0]!.eligible, true);
  const distant = parse([
    line(),
    [OPS.rectangle, [140, 140, 20, 20]],
    [OPS.fill, []],
  ]);
  assert.equal(distant.lines[0]!.eligible, true);
});
test("unknown images use safe simple bounds; unbounded glyph paint cannot certify earlier visibility", () => {
  const image = parse([
    line(),
    [OPS.save, []],
    [OPS.transform, [100, 0, 0, 100, 0, 0]],
    [OPS.paintImageXObject, ["image", 100, 100]],
    [OPS.restore, []],
  ]);
  assert.equal(image.lines[0]!.eligible, false);
  assert.ok(
    image.lines[0]!.reasons.includes("later-image-occlusion-unresolved"),
  );
  const distant = parse([line(), [OPS.paintImageXObject, ["image", 1, 1]]]);
  assert.equal(distant.lines[0]!.eligible, true);
  const text = parse([line(), [OPS.showText, [[]]]]);
  assert.equal(text.lines[0]!.eligible, false);
  assert.ok(
    text.lines[0]!.reasons.includes("later-text-visibility-unresolved"),
  );
  assert.equal(text.diagnostics.occlusionOperations[0]!.bounds, null);
});
test("unsupported color-space change cannot leave a previous black stroke silently eligible", () => {
  const p = parse([
    [OPS.setStrokeColorSpace, ["Pattern"]],
    line(),
    [OPS.setStrokeRGBColor, ["#000000"]],
    line(),
  ]);
  assert.equal(p.lines[0]!.eligible, false);
  assert.equal(p.lines[1]!.eligible, true);
});
test("fabricated PDF uses actual v6 packed stream; rotation preserves metric and source bytes", async () => {
  const source = pdf(
    "0 G 1 w\n20 30 m 70 30 l S\n100 140 m 122.09139 140 140 122.09139 140 100 c S",
  );
  const before = Uint8Array.from(source),
    p = await extractPaintedPage(source, 0);
  assert.deepEqual(source, before);
  assert.equal(
    p.sourceSha256,
    createHash("sha256").update(source).digest("hex"),
  );
  assert.equal(p.lines.length, 1);
  assert.equal(p.arcs.length, 1);
  assert.equal(p.lines[0]!.eligible, true);
  assert.equal(p.paths[0]!.paintOperator, "stroke");
  assert.ok(Array.isArray(p.paths[0]!.rawConstructPath![1]));
  assert.equal(p.paths[1]!.commands[1]!.nativeOperands.length, 6);
  const r = await extractPaintedPage(
    pdf("0 G 1 w\n20 30 m 70 30 l S", "/Rotate 90"),
    0,
  );
  assert.deepEqual(r.lines[0]!.a, { x: 30, y: 20 });
  assert.equal(
    Math.hypot(
      r.lines[0]!.b.x - r.lines[0]!.a.x,
      r.lines[0]!.b.y - r.lines[0]!.a.y,
    ),
    50,
  );
  await assert.rejects(
    () => extractPaintedPage(source, 1),
    /page index outside document/,
  );
});
test("actual normalized fabricated PDF white cover is a visibility negative; white background first is positive", async () => {
  const door = "0 G 1 w 20 30 m 70 30 l S\n";
  const cover = "1 g 10 10 80 40 re f\n";
  const a = await extractPaintedPage(pdf(door + cover), 0),
    b = await extractPaintedPage(pdf(cover + door), 0);
  assert.equal(a.lines[0]!.eligible, false);
  assert.equal(b.lines[0]!.eligible, true);
});
