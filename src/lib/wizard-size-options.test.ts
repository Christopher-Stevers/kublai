import { expect, it } from "vitest";
import { wizardSizeOptions } from "./wizard-size-options";

it("combines stored spellings of a diameter into one broad size choice", () => {
  const options = wizardSizeOptions(
    ["4", '4"', "4 in", "4.0000", null].map((sizeLabel) => ({
      nominal: 4,
      unit: "in",
      sizeLabel,
    })),
  );
  expect(options).toEqual([
    { label: '4"', size: { nominal: 4, unit: "in", sizeLabel: null } },
  ]);
});

it("keeps reducing sizes distinct and preserves their exact catalogue filters", () => {
  const options = wizardSizeOptions(
    ["4", "4 x 2", "4 × 3", "4 x 3 x 2"].map((sizeLabel) => ({
      nominal: 4,
      unit: "in",
      sizeLabel,
    })),
  );
  expect(options.map((option) => option.label)).toEqual([
    '4"',
    '4" x 2"',
    '4" x 3"',
    '4" x 3" x 2"',
  ]);
  expect(options[1]!.size.sizeLabel).toBe("4 x 2");
});
