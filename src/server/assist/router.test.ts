// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/assist/jev", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./jev")>()),
  askJev: vi.fn(),
  jevConfigured: vi.fn(() => true),
}));
vi.mock("~/server/assist/sheet-text", () => ({
  readSheetText: vi.fn(async () => ({
    text: "A101 LEVEL 1 FLOOR PLAN",
    truncated: false,
  })),
}));
import { assistRouter } from "~/server/api/routers/assist";
import { askJev, jevConfigured, type DecisionRequest } from "./jev";
import type { createTRPCContext } from "~/server/api/trpc";
const org = "00000000-0000-4000-8000-000000000001";
const id = "00000000-0000-4000-8000-000000000002";
const other = "00000000-0000-4000-8000-000000000003";
const part = {
  id,
  name: "Copper elbow",
  description: "2 inch",
  materialId: id,
  material: "Copper",
  sizeId: id,
  size: "2 inch",
  categoryId: null,
  category: null,
};
function caller(
  rows: unknown[][],
  userPatch: Record<string, unknown> = {},
  authenticated = true,
) {
  const predicates: ReturnType<PgDialect["sqlToQuery"]>[] = [];
  const queues = [...rows];
  const db = {
    select: vi.fn(() => {
      const result = queues.shift() ?? [];
      const chain: Record<string, unknown> = {};
      for (const method of [
        "from",
        "leftJoin",
        "innerJoin",
        "orderBy",
        "limit",
        "offset",
      ])
        chain[method] = vi.fn(() => chain);
      chain.where = vi.fn((predicate) => {
        predicates.push(new PgDialect().sqlToQuery(predicate));
        return chain;
      });
      chain.then = (
        resolve: (value: unknown) => unknown,
        reject: (error: unknown) => unknown,
      ) => Promise.resolve(result).then(resolve, reject);
      return chain;
    }),
  };
  const context = {
    db,
    userId: authenticated ? crypto.randomUUID() : null,
    user: {
      id,
      organizationId: org,
      role: "user",
      organizationAccessStatus: "approved",
      ...userPatch,
    },
    headers: new Headers(),
  } as unknown as Awaited<ReturnType<typeof createTRPCContext>>;
  return { api: assistRouter.createCaller(context), db, predicates };
}
beforeEach(() => {
  vi.mocked(jevConfigured).mockReturnValue(true);
  vi.mocked(askJev)
    .mockReset()
    .mockImplementation(async (request: DecisionRequest) => ({
      model: "test",
      answers: Object.fromEntries(
        Object.entries(request.questions).map(([key, question]) => {
          const options = Object.keys(question.criteria);
          const choice = options[0]!;
          return [
            key,
            {
              type: "choice" as const,
              choice,
              confidence: 0.9,
              probabilities: Object.fromEntries(
                options.map((option) => [option, option === choice ? 1 : 0]),
              ),
            },
          ];
        }),
      ),
    }));
});
describe("assistance routes", () => {
  it("rejects unauthenticated and unapproved users before accessing records", async () => {
    for (const test of [
      caller([], {}, false),
      caller([], { organizationAccessStatus: "pending" }),
    ]) {
      await expect(test.api.sources({ mode: "catalogue" })).rejects.toThrow();
      expect(test.db.select).not.toHaveBeenCalled();
    }
  });
  it("enforces tool permissions on the server", async () => {
    const test = caller([], {
      permissionConfig: { tabs: { catalogue: false } },
    });
    await expect(
      test.api.run({ mode: "search", query: "elbow" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(test.db.select).not.toHaveBeenCalled();
    expect(askJev).not.toHaveBeenCalled();
  });
  it("does not read or send records when unconfigured", async () => {
    vi.mocked(jevConfigured).mockReturnValue(false);
    const test = caller([]);
    await expect(
      test.api.run({ mode: "search", query: "elbow" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(test.db.select).not.toHaveBeenCalled();
    expect(askJev).not.toHaveBeenCalled();
  });
  it.each(["catalogue", "supplier", "materials", "sheets", "rooms"] as const)(
    "scopes %s source lookup to the caller organization",
    async (mode) => {
      const test = caller([[]]);
      await test.api.sources({ mode });
      expect(test.predicates[0]?.params).toContain(org);
      expect(test.predicates[0]?.sql).toContain("organizationId");
    },
  );
  it.each(["catalogue", "supplier", "materials", "sheets", "rooms"] as const)(
    "rejects missing or foreign %s records before provider calls",
    async (mode) => {
      const test = caller([[]]);
      await expect(test.api.run({ mode, id: other })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(test.predicates[0]?.params).toContain(org);
      expect(test.predicates[0]?.params).toContain(other);
      expect(askJev).not.toHaveBeenCalled();
    },
  );
  it("ranks search candidates through the provider", async () => {
    const test = caller([[part]]);
    const response = await test.api.run({ mode: "search", query: "cu ell" });
    expect(response.results[0]?.partId).toBe(id);
    expect(test.predicates[0]?.params).toContain(org);
    expect(JSON.stringify(vi.mocked(askJev).mock.calls[0]![0])).toContain(
      "cu ell",
    );
  });
  it("builds category and duplicate decisions together", async () => {
    const test = caller([
      [part],
      [{ id: other, name: "Fittings" }],
      [part, { ...part, id: other }],
    ]);
    const response = await test.api.run({ mode: "catalogue", id });
    expect(response.results).toHaveLength(2);
    expect(response.results.some((r) => r.id.startsWith("category:"))).toBe(
      true,
    );
  });
  it("does not use the existing supplier link as evidence of equivalence", async () => {
    const test = caller([
      [
        {
          id,
          name: "Elbow",
          sku: "ABC",
          partId: id,
          packSize: null,
          packUnit: null,
        },
      ],
      [part],
      [part],
    ]);
    const response = await test.api.run({ mode: "supplier", id });
    expect(response.results[0]?.priority).toBe("review");
    expect(response.results[0]?.reason).toContain("pack");
    expect(
      JSON.stringify(vi.mocked(askJev).mock.calls[0]![0].state),
    ).not.toContain("partId");
  });
  it("paginates material checks and prioritizes zero quantities", async () => {
    const rows = Array.from({ length: 21 }, (_, n) => ({
      id: String(n),
      description: "Copper elbow",
      quantity: "0",
      unit: "ea",
    }));
    const test = caller([[{ id, quoteId: other }], rows]);
    const response = await test.api.run({ mode: "materials", id });
    expect(response.results).toHaveLength(20);
    expect(response.nextOffset).toBe(20);
    expect(response.results[0]?.reason).toContain("zero");
  });
  it("classifies extracted drawing text", async () => {
    const test = caller([
      [{ id, jobId: other, name: "A101", imageUrl: "unused", pageNumber: 1 }],
    ]);
    const response = await test.api.run({ mode: "sheets", id });
    expect(response.results[0]?.choice).toBe("plan");
  });
  it("only selects unconfirmed rooms and preserves invalid geometry warnings", async () => {
    const test = caller([
      [{ id, jobId: other }],
      [{ id, name: "Room", source: "auto", shape: {} }],
    ]);
    const response = await test.api.run({ mode: "rooms", id });
    expect(test.predicates[1]?.params).toContain(false);
    expect(test.predicates[1]?.params).toContain(org);
    expect(response.results[0]?.reason).toContain("invalid");
  });
});
