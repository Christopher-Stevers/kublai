import { describe, expect, it } from "vitest";

import { extractSheetName } from "./sheet-name";

describe("extractSheetName", () => {
  it("uses the bottom-right sheet number instead of Floor N", () => {
    const name = extractSheetName(
      [
        { str: "Kitchen", x: 0.2, y: 0.3 },
        { str: "SCALE", x: 0.8, y: 0.85 },
        { str: "A1.01", x: 0.88, y: 0.92 },
        { str: "LEVEL 1 FLOOR PLAN", x: 0.72, y: 0.86 },
      ],
      "Floor 1",
    );
    expect(name).toBe("A1.01");
  });

  it("ignores PAGE / of2 title-block crumbs", () => {
    const name = extractSheetName(
      [
        { str: "PAGE", x: 0.7, y: 0.8 },
        { str: "of", x: 0.78, y: 0.82 },
        { str: "2", x: 0.84, y: 0.82 },
        { str: "of2", x: 0.8, y: 0.9 },
        { str: "A2.01", x: 0.9, y: 0.94 },
      ],
      "Sheet 1",
    );
    expect(name).toBe("A2.01");
  });

  it("falls back to the title-block drawing name", () => {
    const name = extractSheetName(
      [
        { str: "LEVEL 2 FLOOR PLAN", x: 0.7, y: 0.88 },
        { str: "DATE", x: 0.82, y: 0.8 },
      ],
      "Floor 2",
    );
    expect(name).toBe("LEVEL 2 FLOOR PLAN");
  });
});
