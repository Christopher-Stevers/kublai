import { describe, expect, it } from "vitest";

import { tagFromScan, toolScanPath } from "./asset-tags";

describe("tagFromScan", () => {
  it("reads the tag from a label URL", () => {
    expect(tagFromScan("https://foremanhq.stellarator.work/dashboard/assets/scan/T-00042")).toBe("T-00042");
    expect(tagFromScan("https://x.test/dashboard/assets/scan/t-7?utm=1")).toBe("T-7");
  });

  it("accepts a bare or typed tag", () => {
    expect(tagFromScan("  t-00001 \n")).toBe("T-00001");
    expect(tagFromScan("DRILL 5")).toBe("DRILL 5");
  });

  it("decodes encoded tags and tolerates stray percent signs", () => {
    expect(tagFromScan(`https://x.test${toolScanPath("GEN 2/B")}`)).toBe("GEN 2/B");
    expect(tagFromScan("https://x.test/dashboard/assets/scan/GEN%202")).toBe("GEN 2");
    expect(tagFromScan("100%")).toBe("100%");
  });

  it("round-trips through the label path", () => {
    expect(tagFromScan(toolScanPath("T-00099"))).toBe("T-00099");
  });
});
