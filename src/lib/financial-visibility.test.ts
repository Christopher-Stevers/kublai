import { describe, expect, it } from "vitest";
import { redactFinancialValues } from "./financial-visibility";
import { ReplicacheViews } from "~/server/replicache/views";
import type { PatchOperation } from "replicache";

describe("financial visibility", () => {
  it("masks nested app monetary fields without changing counts, dimensions, or the original", () => {
    const date = new Date("2026-10-07");
    const value = { total: 23, quantity: "8", size: "4", date, quote: {
      total: "591.25", subtotalMaterials: "500", markupPercent: "18.25",
      items: [{ unitCost: "62.5", extendedPrice: "500", supplierPart: { lastKnownUnitCost: "62.5" } }],
    }, materialTotal: 591.25, laborRate: "90", subtotalLabor: "180" };
    const before = structuredClone(value);
    const masked = redactFinancialValues(value);
    expect(masked).toEqual({ total: 23, quantity: "8", size: "4", date, quote: {
      total: "", subtotalMaterials: "", markupPercent: "",
      items: [{ unitCost: "", extendedPrice: "", supplierPart: { lastKnownUnitCost: "" } }],
    }, materialTotal: 0, laborRate: "", subtotalLabor: "" });
    expect(value).toEqual(before);
    expect(masked.date).toBe(date);
  });

  it("clears an existing priced offline snapshot when visibility changes and can restore it", () => {
    const store = new ReplicacheViews();
    const patch: PatchOperation[] = [{ op: "put", key: "materialListItem/one", value: {
      id: "one", quantity: "8", unitCost: "62.5", extendedPrice: "500",
    } }];
    const visible = store.create("org:money-true", "revision", patch);
    store.remember(visible);
    const hidden = store.create("org:money-false", "revision", redactFinancialValues(patch));
    const changes = store.diff(hidden, { cvr: visible.id });
    expect(changes).toEqual([{ op: "clear" }, { op: "put", key: "materialListItem/one",
      value: { id: "one", quantity: "8", unitCost: "", extendedPrice: "" } }]);
    store.remember(hidden);
    expect(store.diff(visible, { cvr: hidden.id })).toEqual([{ op: "clear" }, ...patch]);
    expect(store.diff(visible, { cvr: visible.id })).toEqual([]);
  });
});
