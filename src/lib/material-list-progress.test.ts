import { describe, expect, it } from "vitest";
import { materialListProgress } from "./material-list-progress";
const row = {
  quantity: "100",
  sentQuantity: "100",
  receivedQuantity: "0",
  sentOrderStatus: "sent",
  sentAt: null,
  verificationStatus: "pending",
};
describe("overall material progress", () => {
  it("includes all three equally weighted stages", () => {
    expect(materialListProgress([{ ...row, sentOrderStatus: null }])).toBe(0);
    expect(materialListProgress([row])).toBeCloseTo(100 / 3);
    expect(
      materialListProgress([{ ...row, receivedQuantity: "100" }]),
    ).toBeCloseTo(200 / 3);
    expect(
      materialListProgress([
        { ...row, receivedQuantity: "100", verificationStatus: "complete" },
      ]),
    ).toBe(100);
  });
  it("weights quantities and includes unsent material", () => {
    expect(
      materialListProgress([{ ...row, receivedQuantity: "25" }]),
    ).toBeCloseTo(125 / 3);
    expect(
      materialListProgress([row, { ...row, sentOrderStatus: null }]),
    ).toBeCloseTo(100 / 6);
  });
  it("does not count cancelled orders or overdelivery as extra progress", () => {
    expect(
      materialListProgress([
        {
          ...row,
          sentOrderStatus: "cancelled",
          sentAt: "2026-10-21",
          receivedQuantity: "100",
          verificationStatus: "complete",
        },
      ]),
    ).toBe(0);
    expect(
      materialListProgress([
        { ...row, receivedQuantity: "150", verificationStatus: "problem" },
      ]),
    ).toBeCloseTo(200 / 3);
    expect(materialListProgress([])).toBe(0);
    expect(
      materialListProgress([{ ...row, quantity: "0", sentQuantity: "0" }]),
    ).toBe(0);
  });
});
