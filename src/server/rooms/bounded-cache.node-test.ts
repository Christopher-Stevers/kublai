import test from "node:test";
import assert from "node:assert/strict";
import { BoundedCache } from "./bounded-cache";
void test("cache evicts by capacity and bytes and sweeps expired entries", async () => {
  const cache = new BoundedCache<number>(2, 8, 10);
  await cache.get(
    "a",
    async () => 1,
    () => 4,
  );
  await cache.get(
    "b",
    async () => 2,
    () => 4,
  );
  await cache.get(
    "c",
    async () => 3,
    () => 4,
  );
  assert.equal(cache.size, 2);
  assert.equal(
    await cache.get(
      "a",
      async () => 9,
      () => 4,
    ),
    9,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  cache.sweep();
  assert.equal(cache.size, 0);
  await cache.get(
    "large",
    async () => 100,
    () => 100,
  );
  assert.equal(cache.size, 0);
});
void test("different sources do not share pending builds and invalidated builds cannot repopulate", async () => {
  const cache = new BoundedCache<number>(4, 100, 10000);
  let resolve!: (value: number) => void;
  const first = cache.get(
    "floor:old:1",
    () =>
      new Promise<number>((done) => {
        resolve = done;
      }),
    () => 1,
  );
  const duplicate = cache.get(
    "floor:old:1",
    async () => 99,
    () => 1,
  );
  const second = await cache.get(
    "floor:new:1",
    async () => 2,
    () => 1,
  );
  assert.equal(second, 2);
  cache.invalidatePrefix("floor:");
  resolve(1);
  assert.equal(await first, 1);
  assert.equal(await duplicate, 1);
  assert.equal(cache.size, 0);
});

void test("pending builds have an admission limit even after invalidation", async () => {
  const cache = new BoundedCache<number>(4, 100, 10000, 1);
  let resolve!: (value: number) => void;
  const first = cache.get("floor:old", () => new Promise<number>(done => { resolve = done; }), () => 1);
  await Promise.resolve();
  cache.invalidatePrefix("floor:");
  await assert.rejects(cache.get("floor:new", async () => 2, () => 1), /Try again/);
  resolve(1); await first;
  assert.equal(await cache.get("floor:new", async () => 2, () => 1), 2);
});
