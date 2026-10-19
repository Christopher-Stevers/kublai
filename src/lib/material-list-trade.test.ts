import { describe, expect, it } from "vitest";
import { materialListTrade } from "./material-list-trade";

describe("materialListTrade", () => {
  it.each([
    ["Plumbing rough-in", "plumbing"],
    ["Water heater swap", "plumbing"],
    ["HVAC – level 2", "hvac"],
    ["Ductwork", "hvac"],
    ["Electrical panel upgrade", "electrical"],
    ["Material List 3", "general"],
  ])("reads %s as %s", (name, trade) => {
    expect(materialListTrade({ name })).toBe(trade);
  });
  it("marks tool requests regardless of name", () => {
    expect(materialListTrade({ name: "Plumbing tools", kind: "tools" })).toBe(
      "tools",
    );
  });
});
