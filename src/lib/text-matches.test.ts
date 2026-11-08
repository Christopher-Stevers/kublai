import { describe, expect, it } from "vitest";
import { textMatches } from "./text-matches";

const word = (text: string, left: number, top: number) => ({ text, left, top, right: left + 0.1, bottom: top + 0.01 });

describe("textMatches", () => {
  it("finds text containing the query regardless of case, in reading order", () => {
    const words = [word('4" PIPE SLEEVE', 0.5, 0.5), word("Pipe hangers", 0.2, 0.1), word("Duct", 0.1, 0.1)];
    expect(textMatches(words, " pipe ").map((w) => w.text)).toEqual(["Pipe hangers", '4" PIPE SLEEVE']);
  });
  it("finds nothing for an empty query", () => {
    expect(textMatches([word("Pipe", 0, 0)], "  ")).toEqual([]);
  });
});
