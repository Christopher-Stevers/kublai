import { describe, expect, it } from "vitest";
import { jobPriceStatus } from "./job-price-status";
const entry = { id: "e", partDefinitionId: "part", supplierId: "supplier", supplierPartId: "listing", supplierSku: null, unitCost: "10", priceStatus: "confirmed" };
describe("job material quote status", () => {
  it("follows the exact job listing's pricing status", () => {
    const book = { policy: { active: true }, entries: [entry] };
    expect(jobPriceStatus(book, "part", "supplier", "listing")).toBe("confirmed");
    expect(jobPriceStatus({...book, entries: [{...entry, priceStatus: "estimated"}]}, "part")).toBe("estimated");
    expect(jobPriceStatus(book, "part", "other-supplier")).toBe("unlisted");
    expect(jobPriceStatus(book, "other-part")).toBe("unlisted");
  });
  it("excludes inactive pricing and suppliers that do not use job pricing", () => {
    expect(jobPriceStatus({ policy: { active: false }, entries: [entry] }, "part")).toBeUndefined();
    expect(jobPriceStatus({ policy: { active: true }, entries: [{...entry, preferJobPricing: false}] }, "part")).toBeUndefined();
    expect(jobPriceStatus(undefined, "part")).toBeUndefined();
  });
});
