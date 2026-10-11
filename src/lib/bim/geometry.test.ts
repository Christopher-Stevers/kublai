// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  distance3,
  measureArea,
  formatModelMeasure,
  csvCell,
} from "./geometry";
import {
  viewStateSchema,
  uploadMetadataSchema,
  MAX_MODEL_BYTES,
} from "./types";
import { issueBcf } from "./exports";
import { unzipSync, strFromU8 } from "fflate";
const id = "00000000-0000-4000-8000-000000000001";
export const view = viewStateSchema.parse({
  modelIds: [id],
  position: [3, 4, 5],
  target: [0, 0, 0],
  origin: [1000, 0, -2000],
});
describe("construction measurements and interchange", () => {
  it("measures 3D distances and horizontal, vertical and tilted areas in metres", () => {
    expect(distance3([0, 0, 0], [3, 4, 12])).toBe(13);
    expect(
      measureArea([
        [0, 0, 0],
        [3, 0, 0],
        [3, 0, 4],
        [0, 0, 4],
      ]),
    ).toBe(12);
    expect(
      measureArea([
        [0, 0, 0],
        [3, 0, 0],
        [3, 4, 0],
        [0, 4, 0],
      ]),
    ).toBe(12);
    expect(
      measureArea([
        [0, 0, 0],
        [3, 0, 0],
        [3, 4, 4],
        [0, 4, 4],
      ]),
    ).toBeCloseTo(12 * Math.sqrt(2));
    expect(formatModelMeasure(0.3048, "imperial")).toBe("1′ 0″");
  });
  it("neutralizes spreadsheet formulas and quotes metadata safely", () => {
    expect(csvCell('=IMPORTXML("evil")')).toBe('"\'=IMPORTXML(""evil"")"');
    expect(csvCell("a,b")).toBe('"a,b"');
  });
  it("rejects infinite camera positions and over-limit uploads", () => {
    expect(
      viewStateSchema.safeParse({ ...view, position: [Infinity, 0, 0] })
        .success,
    ).toBe(false);
    expect(
      uploadMetadataSchema.safeParse({
        jobId: id,
        name: "a",
        filename: "a.ifc",
        size: MAX_MODEL_BYTES + 1,
      }).success,
    ).toBe(false);
  });
  it("writes BCF camera coordinates in original IFC world axes, escaping issue XML", () => {
    const bytes = issueBcf(
      [
        {
          id,
          revision: 1,
          title: "A & <B>",
          description: "Check",
          kind: "coordination",
          status: "open",
          priority: "normal",
          assigneeId: null,
          dueDate: null,
          point: [0, 0, 0],
          element: null,
          view,
          authorId: "a",
          authorName: "A",
          createdAt: "2026-10-11T00:00:00Z",
          updatedAt: "2026-10-11T00:00:00Z",
          comments: [],
        },
      ],
      [],
    );
    const files = unzipSync(bytes);
    expect(strFromU8(files[`${id}/markup.bcf`]!)).toContain(
      "A &amp; &lt;B&gt;",
    );
    expect(strFromU8(files[`${id}/viewpoint.bcfv`]!)).toContain(
      "<X>1003</X><Y>1995</Y><Z>4</Z>",
    );
  });
});
