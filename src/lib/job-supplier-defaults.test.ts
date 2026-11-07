import { expect, it } from "vitest";
import {
  EMPTY_SUPPLIER_DEFAULTS,
  jobSupplierDefaultsSchema,
  matchJobSupplierDefault,
  type JobSupplierDefaults,
} from "./job-supplier-defaults";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = { supplierId: id(1), bookId: null, label: "Next" };
const priced = { supplierId: id(1), bookId: id(2), label: "Next (Alma)" };
const part = {
  catalogId: id(3),
  materialId: id(4),
  categoryId: id(5),
  sizeNominal: "2",
  sizeUnit: "in",
  sizeLabel: "2 x 1",
};
const rule = {
  id: id(6),
  catalogId: null,
  materialId: null,
  categoryId: null,
  size: null,
  supplier: priced,
};
it("uses first match and changes the winner when rules are reordered", () => {
  const general = { ...rule, id: id(7), supplier: base };
  expect(
    matchJobSupplierDefault({ rules: [rule, general], fallback: base }, part),
  ).toEqual(priced);
  expect(
    matchJobSupplierDefault({ rules: [general, rule], fallback: base }, part),
  ).toEqual(base);
});
it("matches every selected filter and falls back when any filter differs", () => {
  const config: JobSupplierDefaults = {
    rules: [
      {
        ...rule,
        catalogId: part.catalogId,
        materialId: part.materialId,
        categoryId: part.categoryId,
        size: { nominal: 2, unit: "in", label: "2 x 1" },
      },
    ],
    fallback: base,
  };
  expect(matchJobSupplierDefault(config, part)).toEqual(priced);
  for (const changed of [
    { catalogId: id(8) },
    { materialId: id(8) },
    { categoryId: id(8) },
    { sizeUnit: "mm" },
    { sizeLabel: "2 x 1.5" },
    { sizeNominal: null },
  ])
    expect(matchJobSupplierDefault(config, { ...part, ...changed })).toEqual(
      base,
    );
});
it("supports a whole size family, no rules, and distinct standard/book versions", () => {
  expect(
    matchJobSupplierDefault(
      {
        rules: [{ ...rule, size: { nominal: 2, unit: "in" } }],
        fallback: base,
      },
      part,
    ),
  ).toEqual(priced);
  expect(matchJobSupplierDefault(EMPTY_SUPPLIER_DEFAULTS, part)).toBeNull();
  expect(matchJobSupplierDefault({ rules: [], fallback: base }, part)).toEqual(
    base,
  );
});
it("requires a fallback for active rules and rejects duplicate rule ids", () => {
  expect(
    jobSupplierDefaultsSchema.safeParse({ rules: [rule], fallback: null })
      .success,
  ).toBe(false);
  expect(
    jobSupplierDefaultsSchema.safeParse({ rules: [rule, rule], fallback: base })
      .success,
  ).toBe(false);
  expect(
    jobSupplierDefaultsSchema.safeParse({ rules: [rule], fallback: base })
      .success,
  ).toBe(true);
});
