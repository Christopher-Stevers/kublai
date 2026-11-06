import { describe, expect, it } from "vitest";
import { slipOrderPairs } from "./slip-order-pairs";

const line = (id: string, orderItemId: string | null = null) => ({
  id,
  orderItemId,
});
const part = (id: string, score = 0.6, code = false) => ({ id, score, code });
const parts = { a: { partId: "socket" }, b: { partId: "bit" } };

describe("slipOrderPairs", () => {
  it("pairs a missed slip line with the order line of its likely part", () => {
    expect(
      slipOrderPairs([line("1")], { "1": [part("socket")] }, parts),
    ).toEqual({ "1": "a" });
  });
  it("needs a strong likely part, or a code match", () => {
    expect(
      slipOrderPairs([line("1")], { "1": [part("socket", 0.3)] }, parts),
    ).toEqual({});
    expect(
      slipOrderPairs([line("1")], { "1": [part("socket", 0.3, true)] }, parts),
    ).toEqual({ "1": "a" });
  });
  it("leaves order lines that a slip line already has", () => {
    expect(
      slipOrderPairs(
        [line("0", "a"), line("1")],
        { "1": [part("socket")] },
        parts,
      ),
    ).toEqual({});
    expect(
      slipOrderPairs([line("1")], { "1": [part("socket")] }, parts, ["a"]),
    ).toEqual({});
  });
  it("leaves two slip lines after one order line for the reviewer", () => {
    expect(
      slipOrderPairs(
        [line("1"), line("2")],
        { "1": [part("socket")], "2": [part("socket")] },
        parts,
      ),
    ).toEqual({});
  });
  it("leaves a part that is on two order lines", () => {
    expect(
      slipOrderPairs(
        [line("1")],
        { "1": [part("socket")] },
        { ...parts, c: { partId: "socket" } },
      ),
    ).toEqual({});
  });
  it("skips likely parts that are not on the order", () => {
    expect(
      slipOrderPairs(
        [line("1")],
        { "1": [part("pipe", 0.9), part("bit")] },
        parts,
      ),
    ).toEqual({ "1": "b" });
  });
  it("leaves excluded and approved lines alone", () => {
    expect(
      slipOrderPairs(
        [
          { ...line("1"), ignored: true },
          { ...line("2"), approved: {} },
        ],
        { "1": [part("socket")], "2": [part("bit")] },
        parts,
      ),
    ).toEqual({});
  });
});

it("does not automatically rejoin a comparison the reviewer split", () => {
  expect(slipOrderPairs([{...line("1"), pairingDismissed: true}], {"1": [part("socket", 1, true)]}, parts)).toEqual({});
});
