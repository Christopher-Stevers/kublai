import { expect, it } from "vitest";
import { sortWizardSizeFamily, wizardExactSizeLabel } from "./wizard-size-selection";
it("keeps a single diameter broad and explicit reducing selections exact", () => {
  for (const label of ['10', '10"', '10 in', null]) expect(wizardExactSizeLabel(label)).toBeUndefined();
  for (const label of ['10 x 4', '10" x 4"', '10″ × 4″', '1-1/2 x 1/2']) expect(wizardExactSizeLabel(label)).toBe(label);
});
it("puts straight parts first, then reducing sizes, preserving part order within each size", () => {
  const parts = [{ id: 1, sizeLabel: '10 x 8' }, { id: 2, sizeLabel: '10' }, { id: 3, sizeLabel: '10 x 4' }, { id: 4, sizeLabel: null }, { id: 5, sizeLabel: '10 x 4' }];
  expect(sortWizardSizeFamily(parts).map(p => p.id)).toEqual([2, 4, 3, 5, 1]);
  expect(parts[0]!.id).toBe(1);
});
