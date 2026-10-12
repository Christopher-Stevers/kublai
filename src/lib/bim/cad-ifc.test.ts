// @vitest-environment node
import { describe, expect, it } from "vitest";
import { designIfc, ifcGuid, stepString } from "./cad-ifc";
import { createSketch } from "./cad-geometry";
import { designDxf } from "./cad-export";
import { newDesignElement } from "./design";
describe("portable edited IFC", () => {
  it("encodes all 128 UUID bits in a 22-character IFC identifier", () => {
    expect(ifcGuid("00000000-0000-0000-0000-000000000000")).toBe(
      "0000000000000000000000",
    );
    expect(ifcGuid("ffffffff-ffff-ffff-ffff-ffffffffffff")).toBe(
      "3$$$$$$$$$$$$$$$$$$$$$",
    );
    const ids = new Set(Array.from({ length: 1000 }, () => ifcGuid()));
    expect(ids.size).toBe(1000);
  });
  it("escapes STEP strings including quotes, slashes, Unicode and control characters", () => {
    expect(stepString("Pipe's \\ Ø\n")).toBe(
      "'Pipe''s \\X2\\005C\\X0\\ \\X2\\00D8000A\\X0\\'",
    );
  });
  it("preserves dimension annotations in IFC and DXF", () => {
    const element = createSketch(
      "dimension",
      [
        [0, 0, 0],
        [3, 4, 0],
      ],
      "front",
    );
    const doc = { elements: [element], overrides: [] },
      ifc = designIfc(doc, "Measured run"),
      dxf = designDxf(doc);
    expect(ifc).toContain("IFCANNOTATION(");
    expect(ifc).toContain("IFCTEXTLITERALWITHEXTENT('5.00 m'");
    expect(ifc.match(/IFCPOLYLINE\(/g)).toHaveLength(7);
    expect(dxf).toContain("0\nMTEXT\n");
    expect(dxf).toContain("1\n5.00 m\n");
    expect(dxf.match(/0\nLINE\n/g)).toHaveLength(7);
  });
  it("exports edited geometry and metadata without rewriting the original", () => {
    const e = newDesignElement("box", [2, 3, 4]);
    e.name = "Pump base";
    e.material = "Concrete";
    e.layer = "Equipment";
    const doc = { elements: [e], overrides: [] };
    const before = JSON.stringify(doc),
      text = designIfc(doc, "Test");
    expect(text).toContain("FILE_SCHEMA(('IFC4'))");
    expect(text).toContain("IFCTRIANGULATEDFACESET");
    expect(text).toContain("IFCCARTESIANPOINT((2.,-4.,3.))");
    expect(text).toContain("'Concrete'");
    expect(text).toContain(ifcGuid(e.id));
    expect(JSON.stringify(doc)).toBe(before);
  });
});
