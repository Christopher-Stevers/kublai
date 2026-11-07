import { describe, it, expect } from "vitest";
import { superLabelSchema, textInLabelBox } from "./super-label";
const box = { left: 0.6, top: 0.8, right: 0.9, bottom: 0.95 };
describe("Super Label", () => {
  it("reads each sheet's own words and excludes nearby fields", () => {
    const words = (text: string) => [
      { text, left: 0.65, top: 0.82, right: 0.8, bottom: 0.84 },
      { text: "OUTSIDE", left: 0.1, top: 0.82, right: 0.3, bottom: 0.84 },
    ];
    expect(textInLabelBox(words("LEVEL 1"), box)).toBe("LEVEL 1");
    expect(textInLabelBox(words("LEVEL 8"), box)).toBe("LEVEL 8");
  });
  it("keeps labels and numbers separate", () => {
    const words = [
      { text: "PLAN", left: 0.65, top: 0.82, right: 0.8, bottom: 0.84 },
      { text: "A-102", left: 0.65, top: 0.96, right: 0.8, bottom: 0.98 },
    ];
    expect(textInLabelBox(words, box)).toBe("PLAN");
    expect(textInLabelBox(words, { ...box, top: 0.95, bottom: 1 })).toBe(
      "A-102",
    );
  });
  it("rejects empty, reversed and out of page selections", () => {
    for (const title of [
      { ...box, right: box.left },
      { ...box, left: 1 },
      { ...box, bottom: 1.1 },
    ])
      expect(superLabelSchema.safeParse({ title, number: box }).success).toBe(
        false,
      );
    expect(textInLabelBox([], box)).toBe("");
  });
});
