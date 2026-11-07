// @vitest-environment node
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { expect, it, vi } from "vitest";
import {
  supplierVersionPrice,
  validateJobSupplierDefaults,
} from "./job-supplier-defaults";
const base = {
  supplierId: "00000000-0000-4000-8000-000000000001",
  bookId: null,
  label: "Next",
};
it("rejects foreign suppliers and books before saving a rule", async () => {
  const execute = vi
    .fn<(query: SQL) => Promise<Record<string, unknown>[]>>()
    .mockResolvedValue([]);
  await expect(
    validateJobSupplierDefaults({ execute } as never, "org", {
      rules: [],
      fallback: base,
    }),
  ).rejects.toThrow("no longer available");
  const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
  expect(query.params).toContain("org");
  expect(query.params).toContain(base.supplierId);
});
it("does not fill a missing book price from a standard listing", async () => {
  const execute = vi
    .fn<(query: SQL) => Promise<Record<string, unknown>[]>>()
    .mockResolvedValueOnce([{ name: "Next" }])
    .mockResolvedValueOnce([{ name: "Alma" }])
    .mockResolvedValueOnce([
      { id: "listing", unitCost: null, supplierSku: "ABC", packSize: "1" },
    ]);
  const version = {
    ...base,
    bookId: "00000000-0000-4000-8000-000000000002",
    label: "Next (Alma)",
  };
  const value = await supplierVersionPrice(
    { execute } as never,
    "org",
    version,
    "part",
  );
  expect(value.unitCost).toBeNull();
  expect(value.bookName).toBe("Alma");
  const query = new PgDialect().sqlToQuery(execute.mock.calls[2]![0]);
  expect(query.sql).toContain('e."unitCost"');
  expect(query.sql).not.toContain('sp."lastKnownUnitCost"');
  expect(query.params).toContain("org");
});
it("keeps standard pricing separate and rejects a deleted named version", async () => {
  const execute = vi
    .fn<(query: SQL) => Promise<Record<string, unknown>[]>>()
    .mockResolvedValueOnce([{ name: "Next" }])
    .mockResolvedValueOnce([
      { id: "listing", unitCost: "4.25", supplierSku: null, packSize: null },
    ]);
  expect(
    (await supplierVersionPrice({ execute } as never, "org", base, "part"))
      .unitCost,
  ).toBe("4.25");
  const deleted = vi
    .fn<(query: SQL) => Promise<Record<string, unknown>[]>>()
    .mockResolvedValueOnce([{ name: "Next" }])
    .mockResolvedValueOnce([]);
  await expect(
    supplierVersionPrice(
      { execute: deleted } as never,
      "org",
      { ...base, bookId: "book" },
      "part",
    ),
  ).rejects.toThrow("unavailable");
});
