// @vitest-environment node
import { expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { getJobPriceBooks } from "./job-pricing";

it("batches policies and entries, retaining inactive/missing jobs and scoped predicates", async () => {
  const policies = [
    { id: "p1", jobId: "j1", active: true },
    { id: "p2", jobId: "j2", active: false },
    { id: "p3", jobId: "j3", active: true },
  ];
  const rows = [
    policies,
    [
      { id: "e1", priceListId: "p1" },
      { id: "e3", priceListId: "p3" },
    ],
  ];
  const predicates: ReturnType<PgDialect["sqlToQuery"]>[] = [];
  const dialect = new PgDialect();
  const select = vi.fn(() => {
    const query = Object.assign(Promise.resolve(rows.shift()), {
      from: () => query,
      innerJoin: () => query,
      leftJoin: () => query,
      where: (sql: SQL) => {
        predicates.push(dialect.sqlToQuery(sql));
        return query;
      },
    });
    return query;
  });
  const books = await getJobPriceBooks({ select } as never, "tenant", [
    "j1",
    "j2",
    "j3",
    "missing",
  ]);
  expect(select).toHaveBeenCalledTimes(2);
  expect(books.get("j1")?.entries.map((e) => e.id)).toEqual(["e1"]);
  expect(books.get("j3")?.entries.map((e) => e.id)).toEqual(["e3"]);
  expect(books.get("j2")).toEqual({ policy: policies[1], entries: [] });
  expect(books.get("missing")).toEqual({ policy: null, entries: [] });
  expect(predicates[0]?.params).toContain("tenant");
  expect(predicates[1]?.params).toEqual(["p1", "p3", "tenant", true]);
  select.mockClear();
  expect(await getJobPriceBooks({ select } as never, "tenant", [])).toEqual(
    new Map(),
  );
  expect(select).not.toHaveBeenCalled();
});
