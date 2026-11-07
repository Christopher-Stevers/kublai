import { describe, expect, it } from "vitest";
import {
  drawingMarkupSchema,
  type DrawingEntity,
  type DrawingMarkup,
} from "./drawing-workspace";
import {
  pipeComponentSourceKey,
  pipeSymbolTemplates,
  reviewedPipeComponent,
  pipeComponentsCsv,
} from "./pipe-component-review";
import type { PipeComponentCandidate } from "./pipe-components-types";
const sourceSheetId = "031060be-2d10-4c21-bda2-dd1619a1e280";
const sourceKey = pipeComponentSourceKey("/revision1.pdf", 1);
const candidate: PipeComponentCandidate = {
  id: "pc-1",
  fingerprint: "f1",
  kind: "valve",
  name: "Valve",
  source: "geometry",
  system: "DCW",
  evidence: "Crossing symbol",
  point: { x: 0.3, y: 0.4 },
  box: { left: 0.29, right: 0.31, top: 0.39, bottom: 0.41 },
};
const markup: DrawingMarkup = {
  sourceSheetId,
  type: "count",
  points: [candidate.point],
  stroke: "#000000",
  width: 2,
  pipeComponent: {
    candidateId: candidate.id,
    fingerprint: candidate.fingerprint,
    sourceKey,
    kind: "valve",
    name: "Ball valve",
    source: "geometry",
    system: "DCW",
    evidence: candidate.evidence,
  },
};
const record = (data: DrawingMarkup): DrawingEntity => ({
  id: "one",
  kind: "markup",
  data,
  sheetId: sourceSheetId,
  revision: 1,
  visibility: "published",
  authorId: "tim",
  authorName: "Tim",
  comments: [],
  createdAt: "",
  updatedAt: "",
});
describe("reviewed piping records", () => {
  it("roundtrips review metadata through the real save schema", () => {
    expect(
      drawingMarkupSchema.parse(JSON.parse(JSON.stringify(markup))),
    ).toEqual(markup);
    expect(
      drawingMarkupSchema.safeParse({
        ...markup,
        type: "dimension",
        points: [candidate.point, { x: 0.4, y: 0.4 }],
      }).success,
    ).toBe(false);
    expect(
      drawingMarkupSchema.safeParse({
        ...markup,
        pipeSymbolTemplate: { sourceKey, kind: "valve", name: "Valve" },
      }).success,
    ).toBe(false);
  });
  it("requires the same revision, evidence fingerprint and unmoved count point", () => {
    expect(
      reviewedPipeComponent([record(markup)], sourceKey, candidate),
    ).toBeDefined();
    expect(
      reviewedPipeComponent(
        [record(markup)],
        pipeComponentSourceKey("/revision2.pdf", 1),
        candidate,
      ),
    ).toBeUndefined();
    expect(
      reviewedPipeComponent([record(markup)], sourceKey, {
        ...candidate,
        fingerprint: "new",
      }),
    ).toBeUndefined();
    expect(
      reviewedPipeComponent(
        [record({ ...markup, points: [{ x: 0.6, y: 0.6 }] })],
        sourceKey,
        candidate,
      ),
    ).toBeUndefined();
    expect(
      reviewedPipeComponent(
        [{ ...record(markup), visibility: "archived" }],
        sourceKey,
        candidate,
      ),
    ).toBeUndefined();
  });
  it("scopes taught symbols to the original PDF and roundtrips their rectangle", () => {
    const template = drawingMarkupSchema.parse({
      sourceSheetId,
      type: "rect",
      points: [
        { x: 0.2, y: 0.2 },
        { x: 0.1, y: 0.1 },
      ],
      pipeSymbolTemplate: { sourceKey, kind: "valve", name: "Ball valve" },
    });
    expect(pipeSymbolTemplates([record(template)], sourceKey)[0]).toMatchObject(
      {
        kind: "valve",
        name: "Ball valve",
        box: { left: 0.1, right: 0.2, top: 0.1, bottom: 0.2 },
      },
    );
    expect(
      pipeSymbolTemplates(
        [record(template)],
        pipeComponentSourceKey("/other.pdf", 1),
      ),
    ).toEqual([]);
  });
  it("exports individual reviewed records with sheet locations and spreadsheet-safe cells", () => {
    const csv = pipeComponentsCsv([
      {
        ...markup,
        pipeComponent: {
          ...markup.pipeComponent!,
          name: '=HYPERLINK("evil")',
          size: '2"',
        },
      },
    ]);
    expect(csv).toContain("Reviewed");
    expect(csv).toContain(sourceSheetId);
    expect(csv).toContain('"0.3","0.4"');
    expect(csv).toContain('"\'=HYPERLINK(""evil"")"');
    expect(csv).toContain('"2"""');
    expect(pipeComponentsCsv([]).split("\r\n")).toHaveLength(1);
  });
});
