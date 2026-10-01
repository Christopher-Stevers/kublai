import assert from "node:assert/strict";
import test from "node:test";
import { extractPaintedPage } from "./painted-paths";
import { detectPortals } from "./portals";

/** Independently hand-specified PDF drawing; no model, source floor or generated targets. */
function pdf(contents: string, extraPage = "") {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 180] /Resources << >> /Contents 4 0 R ${extraPage} >>`,
    `<< /Length ${Buffer.byteLength(contents)} >>\nstream\n${contents}\nendstream`,
  ];
  let out = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets
    .slice(1)
    .map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`)
    .join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out));
}

const wall = [
  "10 100 m 60 100 l S",
  "10 104 m 60 104 l S",
  "100 100 m 180 100 l S",
  "100 104 m 180 104 l S",
];
const jambs = ["60 100 m 60 104 l S", "100 100 m 100 104 l S"];
const leaf = "60 104 m 60 144 l S";
const swing = "60 144 m 82.09139 144 100 126.09139 100 104 c S";
const source = (parts: string[]) => `0 G 0.5 w\n${parts.join("\n")}\n`;

test("independent non-square PDF keeps a real door center and closes the wall gap, not the arc chord", async () => {
  const page = await extractPaintedPage(
    pdf(source([...wall, ...jambs, leaf, swing])),
    0,
  );
  assert.equal(page.width, 200);
  assert.equal(page.height, 180);
  const result = detectPortals(page.lines, page.arcs);
  assert.equal(result.supported.length, 1);
  const p = result.supported[0]!;
  const ends = p.closure.slice().sort((a, b) => a.x - b.x);
  assert.ok(Math.hypot(ends[0]!.x - 60, ends[0]!.y - 76) < 1.2);
  assert.ok(Math.hypot(ends[1]!.x - 100, ends[1]!.y - 76) < 1.2);
  assert.ok(
    Math.abs(
      Math.hypot(ends[1]!.x - ends[0]!.x, ends[1]!.y - ends[0]!.y) - 40,
    ) < 1.2,
  );
  assert.equal(p.support.jambIds.length, 2);
  assert.equal(p.support.wallFaceIds.length, 4);
  assert.equal(p.requiresReview, true);
  assert.equal(p.calibratedConfidence, false);
});
test("PDF furniture-like arcs cannot close a room without both jambs and wall chains", async () => {
  for (const parts of [
    [leaf, swing],
    [...wall, jambs[0]!, leaf, swing],
    [...wall.slice(0, 2), ...jambs, leaf, swing],
  ]) {
    const page = await extractPaintedPage(pdf(source(parts)), 0);
    const result = detectPortals(page.lines, page.arcs);
    assert.equal(result.supported.length, 0);
  }
});
test("a door-like mark clipped away cannot become a certified portal", async () => {
  const page = await extractPaintedPage(
    pdf(source(["q 0 0 5 5 re W n", ...wall, ...jambs, leaf, swing, "Q"])),
    0,
  );
  assert.equal(detectPortals(page.lines, page.arcs).supported.length, 0);
});
test("page rotation preserves physical door width rather than independently normalized x/y distances", async () => {
  const page = await extractPaintedPage(
    pdf(source([...wall, ...jambs, leaf, swing]), "/Rotate 90"),
    0,
  );
  const result = detectPortals(page.lines, page.arcs);
  assert.equal(result.supported.length, 1);
  assert.equal(page.width, 180);
  assert.equal(page.height, 200);
  const p = result.supported[0]!;
  assert.ok(
    Math.abs(
      Math.hypot(
        p.closure[1].x - p.closure[0].x,
        p.closure[1].y - p.closure[0].y,
      ) - 40,
    ) < 1.2,
  );
});
test("line-sampled PDF swing has the same physical closure without inventing missing samples", async () => {
  const vertices = Array.from({ length: 21 }, (_, i) => {
    const angle = (Math.PI / 2) * (1 - i / 20);
    return `${(60 + 40 * Math.cos(angle)).toFixed(5)} ${(104 + 40 * Math.sin(angle)).toFixed(5)}`;
  });
  const sampled = `${vertices[0]} m ${vertices
    .slice(1)
    .map((p) => `${p} l`)
    .join(" ")} S`;
  const page = await extractPaintedPage(
    pdf(source([...wall, ...jambs, leaf, sampled])),
    0,
  );
  assert.equal(detectPortals(page.lines, page.arcs).supported.length, 1);
  const dotted = vertices
    .slice(0, -1)
    .filter((_, i) => i % 2 === 0)
    .map((p, i) => `${p} m ${vertices[i * 2 + 1]} l S`);
  const broken = await extractPaintedPage(
    pdf(source([...wall, ...jambs, leaf, ...dotted])),
    0,
  );
  assert.equal(detectPortals(broken.lines, broken.arcs).supported.length, 0);
});
test("white overpaint removes door evidence; a white background before a door does not", async () => {
  const visible = source([...wall, ...jambs, leaf, swing]);
  const cover = "1 g 0 0 200 180 re f\n";
  const hidden = await extractPaintedPage(pdf(`${visible}${cover}`), 0);
  assert.equal(detectPortals(hidden.lines, hidden.arcs).supported.length, 0);
  const prior = await extractPaintedPage(pdf(`${cover}${visible}`), 0);
  assert.equal(detectPortals(prior.lines, prior.arcs).supported.length, 1);
});
