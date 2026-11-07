import { describe, it, expect } from "vitest";
import { findJobPrice, indexJobPrices, listedPartsFirst, parseJobPrice } from "./job-pricing";
import { orderApprovalFingerprint } from "~/server/job-pricing";
import { resolvePermissions } from "~/server/auth/permissions";
import { redactFinancialValues } from "./financial-visibility";

describe("job purchasing rules", () => {
  it("rejects ambiguous spreadsheet amounts instead of guessing the decimal separator", () => {
    expect(parseJobPrice("$1,234.56")).toBe(1234.56);
    expect(parseJobPrice("")).toBeNull();
    expect(parseJobPrice("0.0001")).toBe(0.0001);
    for (const v of ["1,25", "-1", "NaN", "1.00001", "12$34"])
      expect(() => parseJobPrice(v)).toThrow();
  });
  const entries = [
    {
      id: "1",
      partDefinitionId: "p",
      supplierId: "s",
      supplierPartId: "sp",
      supplierSku: "sku",
      unitCost: "5",
      priceStatus: "estimated",
    },
  ];
  it("resolves permanent part and supplier IDs, rather than similar descriptions", () => {
    expect(findJobPrice(entries, "p", "s")?.supplierSku).toBe("sku");
    expect(findJobPrice(entries, "p", "another")).toBeUndefined();
    expect(findJobPrice(entries, "unrelated", "s")).toBeUndefined();
  });
  it("indexed prices preserve listing preference, supplier boundaries and fallback order", () => {
    const rows = Array.from({ length: 1000 }, (_, n) => ({
      ...entries[0]!, id: String(n), partDefinitionId: `part-${n % 23}`,
      supplierId: `supplier-${n % 7}`, supplierPartId: `listing-${n}`,
    }));
    const index = indexJobPrices(rows);
    for (const part of [undefined, "missing", ...Array.from(index.keys())])
      for (const supplier of [null, "missing", "supplier-1", "supplier-3"])
        for (const listing of [null, "missing", "listing-47", "listing-92"])
          expect(findJobPrice(index, part, supplier, listing)).toBe(findJobPrice(rows, part, supplier, listing));
    expect(findJobPrice(indexJobPrices([]), "part-1")).toBeUndefined();
  });
  it("preserves the ordinary sort within listed and unlisted parts", () => {
    expect(listedPartsFirst([4, 3, 2, 1], (n) => n % 2 === 1)).toEqual([
      3, 1, 4, 2,
    ]);
  });
  it("reserves price maintenance and approval for explicitly authorized accounts", () => {
    expect(resolvePermissions({ role: "worker" })["jobPricing.approve"]).toBe(
      false,
    );
    expect(resolvePermissions({ role: "user" })["jobPricing.manage"]).toBe(
      false,
    );
    expect(resolvePermissions({ role: "admin" })["jobPricing.approve"]).toBe(
      true,
    );
  });
  it("redacts estimated and confirmed costs from nested approval snapshots", () => {
    expect(
      redactFinancialValues({ snapshot: [{ unitCost: "123", quantity: "4" }] }),
    ).toEqual({ snapshot: [{ unitCost: "", quantity: "4" }] });
  });
  it("binds approvals to price revision, supplier, quantity and exact lines but not row order", () => {
    const line = {
      id: "q",
      partDefinitionId: "p",
      supplierPartId: "s",
      supplierSku: "code",
      quantity: "2",
      unitCost: "4.000",
      descriptionSnapshot: "Part",
      listed: false,
    };
    const input = {
      organizationId: "org",
      jobId: "job",
      materialListId: "list",
      supplierId: "supplier",
      revision: 1,
      items: [line],
    };
    const before = orderApprovalFingerprint(input);
    expect(
      orderApprovalFingerprint({
        ...input,
        items: [{ ...line, quantity: "2.000000" }],
      }),
    ).toBe(before);
    for (const change of [
      { revision: 2 },
      { supplierId: "other" },
      { items: [{ ...line, quantity: "3" }] },
      { items: [{ ...line, id: "new-line" }] },
    ])
      expect(orderApprovalFingerprint({ ...input, ...change })).not.toBe(
        before,
      );
  });
});

it("excludes disabled supplier pricing from automatic price selection without removing membership", async () => {
 const {findPreferredJobPrice,findJobPrice}=await import('./job-pricing');
 const rows=[{id:'entry',partDefinitionId:'part',supplierId:'supplier',supplierPartId:'listing',supplierSku:'sku',unitCost:'3',priceStatus:'estimated',preferJobPricing:false}];
 expect(findPreferredJobPrice(rows,'part','supplier')).toBeUndefined();
 expect(findJobPrice(rows,'part','supplier')).toBe(rows[0]);
 expect(findPreferredJobPrice([{...rows[0]!,preferJobPricing:true}],'part','supplier')?.unitCost).toBe('3');
});
