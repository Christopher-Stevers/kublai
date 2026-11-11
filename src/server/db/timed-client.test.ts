// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { timedPostgresClient } from "./timed-client";
import { withQueryStats } from "./query-stats";
import { withServerTiming } from "../server-timing";

class LazyQuery extends Promise<string[]> {
  static get [Symbol.species]() {
    return Promise;
  }
  resolveResult!: (value: string[]) => void;
  rejectResult!: (error: Error) => void;
  started = false;
  arrayMode = false;
  constructor(readonly fail = false) {
    let resolve!: (value: string[]) => void;
    let reject!: (error: Error) => void;
    super((yes, no) => {
      resolve = yes;
      reject = no;
    });
    this.resolveResult = resolve;
    this.rejectResult = reject;
  }
  values() {
    this.arrayMode = true;
    return this;
  }
  execute() {
    if (!this.started) {
      this.started = true;
      setTimeout(
        () =>
          this.fail
            ? this.rejectResult(new Error("query failed"))
            : this.resolveResult([this.arrayMode ? "array" : "row"]),
        10,
      );
    }
    return this;
  }
  then<TResult1 = string[], TResult2 = never>(
    yes?: ((value: string[]) => TResult1 | PromiseLike<TResult1>) | null,
    no?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    this.execute();
    return super.then(yes, no);
  }
}

describe("database timing", () => {
  it("keeps queries lazy, preserves modifiers and does not double count awaited queries", async () => {
    const raw = new LazyQuery();
    const client = timedPostgresClient({ unsafe: () => raw });
    const { result, stats } = await withQueryStats(async () => {
      const query = client.unsafe().values();
      expect(raw.started).toBe(false);
      const result = await query;
      await query;
      return result;
    });
    expect(result).toEqual(["array"]);
    expect(stats.databaseMs).toBeGreaterThan(5);
    expect(stats.databaseMs).toBeLessThan(100);
  });
  it("measures failed queries and isolates concurrent request scopes", async () => {
    const fail = timedPostgresClient({ unsafe: () => new LazyQuery(true) });
    const [bad, empty] = await Promise.all([
      withQueryStats(async () => {
        await expect(fail.unsafe()).rejects.toThrow("query failed");
      }),
      withQueryStats(async () => {}),
    ]);
    expect(bad.stats.databaseMs).toBeGreaterThan(5);
    expect(empty.stats.databaseMs).toBe(0);
  });
  it("covers transaction/savepoint clients and propagates nested scopes", async () => {
    const transaction = { unsafe: () => new LazyQuery() };
    const client = timedPostgresClient({
      begin: async (fn: (c: typeof transaction) => unknown) => fn(transaction),
    });
    const outer = await withQueryStats(() =>
      withQueryStats(() => client.begin(async (tx) => await tx.unsafe())),
    );
    expect(outer.stats.databaseMs).toBeGreaterThan(5);
    expect(outer.stats.databaseMs).toBe(outer.result.stats.databaseMs);
  });
  it("does not buffer streamed response bodies to measure headers", async () => {
    const pull = vi.fn();
    const response = await withServerTiming(
      async () =>
        new Response(new ReadableStream({ pull }), {
          headers: { "content-type": "application/jsonl" },
        }),
    );
    expect(response.bodyUsed).toBe(false);
    expect(response.headers.get("Server-Timing")).toContain(
      'db;dur=0.0;desc="before stream headers"',
    );
    await response.body?.cancel();
  });
});
