// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { importDxf } from "./cad-dxf-import";
import { objectMatrix } from "./cad-geometry";
import { designDxf } from "./cad-export";
import { designSchema, newDesignElement } from "./design";
import expected from "./fixtures/cad-import-expected.json";
const text = readFileSync(
  new URL("./fixtures/cad-import.dxf", import.meta.url),
  "utf8",
);
const world = (e: ReturnType<typeof importDxf>["elements"][number]) =>
  e.points!.map((p) => new Vector3(...p).applyMatrix4(objectMatrix(e)));
describe("DXF interoperability with an independently generated ezdxf fixture", () => {
  it("converts declared millimetres to metres and retains layers", () => {
    const result = importDxf(text);
    expect(result.units).toBe("mm");
    const first = result.elements[0]!;
    expect(world(first)[1]!.x).toBeCloseTo(1);
    expect(first.layer).toBe("Pipework");
    expect(result.elements.length).toBe(5);
    expect(designSchema.safeParse({ ...result, overrides: [] }).success).toBe(
      true,
    );
    expect(result.warnings.some((w) => w.includes("TEXT"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("HATCH"))).toBe(true);
  });
  it("retains tilted circle coordinates using the DXF arbitrary-axis convention", () => {
    const points = world(
      importDxf(text).elements.find((e) => e.name.includes("CIRCLE"))!,
    );
    for (const target of expected.circleQuarterPoints)
      expect(
        Math.min(
          ...points.map((p) =>
            p.distanceTo(new Vector3(...(target as [number, number, number]))),
          ),
        ),
      ).toBeLessThan(1e-6);
  });
  it("expands rotated/scaled blocks about their defined base point", () => {
    const line = importDxf(text).elements.filter((e) =>
      e.name.endsWith(" · LINE"),
    )[1]!;
    world(line).forEach((p, i) =>
      expect(
        p.distanceTo(
          new Vector3(...(expected.blockLine[i] as [number, number, number])),
        ),
      ).toBeLessThan(1e-6),
    );
  });
  it("preserves bulge arcs and true 3D polylines", () => {
    const elements = importDxf(text).elements;
    const arc = world(elements.find((e) => e.name.endsWith("LWPOLYLINE"))!);
    expect(Math.max(...arc.map((p) => p.z))).toBeCloseTo(-1, 5);
    const line = world(elements.at(-1)!);
    expect(line[0]!.y).toBeCloseTo(1);
    expect(line[1]!.y).toBeCloseTo(2);
  });
  it("requires explicit units for unitless files", () => {
    const unitless = text.replace(/(\$INSUNITS\s+70\s+)4/, "$1" + "0");
    expect(() => importDxf(unitless)).toThrow("Choose its units");
    expect(importDxf(unitless, "mm").elements.length).toBe(5);
  });
  it("rejects binary and oversized input before parsing", () => {
    expect(() => importDxf("AutoCAD Binary DXF")).toThrow("ASCII");
    expect(() => importDxf(" ".repeat(8_000_001))).toThrow("8 MB");
  });
  it("round-trips exported 3D centrelines without flattening elevation", () => {
    const pipe = newDesignElement("pipe", [12, 8, -3]);
    pipe.size[1] = 4;
    pipe.rotation = [30, 20, 10];
    const parsed = importDxf(designDxf({ elements: [pipe], overrides: [] }));
    const matrix = objectMatrix(pipe),
      a = new Vector3(0, -2, 0).applyMatrix4(matrix),
      b = new Vector3(0, 2, 0).applyMatrix4(matrix),
      points = world(parsed.elements[0]!);
    expect(points[0]!.distanceTo(a)).toBeLessThan(1e-6);
    expect(points[1]!.distanceTo(b)).toBeLessThan(1e-6);
  });
});
