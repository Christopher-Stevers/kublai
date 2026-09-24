import assert from 'node:assert/strict';
import test from 'node:test';
import { partitionRegion } from './seeded-partition';
import type { PartitionOptions } from './seeded-partition';

const modes = ['geodesic', 'watershed'] as const;
const plane = (width: number, height: number): PartitionOptions => ({
  width, height, regions: new Int32Array(width * height).fill(1),
  cost: new Float32Array(width * height), seeds: [], mode: 'geodesic', penalty: 32,
});

for (const mode of modes) {
  test(`${mode}: a dense wall outweighs straight-line proximity`, () => {
    const input = { ...plane(9, 5), mode, seeds: [{ index: 21, label: 1 }, { index: 26, label: 2 }] };
    const empty = partitionRegion(input);
    assert.equal(empty[23], 1, 'the left seed is nearer without a wall');
    for (let y = 0; y < input.height; y++) input.cost[y * input.width + 4] = 1;
    const result = partitionRegion(input);
    assert.equal(result[23], 2, 'the right seed wins without crossing the wall');
    assert.equal(result[21], 1);
    assert.equal(result[26], 2);
    assert.ok(result.every(label => label > 0), 'every pixel in a seeded region is assigned');
  });

  test(`${mode}: paths can route through an opening instead of crossing dense ink`, () => {
    const input = { ...plane(9, 7), mode, penalty: 100,
      seeds: [{ index: 21, label: 1 }, { index: 60, label: 2 }] };
    // The close first seed is on the left of a vertical wall. The second is in
    // the distant lower-right corner. Opening the wall gives the first seed a
    // short low-cost route to the probe at (5, 2).
    for (let y = 0; y < input.height; y++) input.cost[y * input.width + 4] = 1;
    assert.equal(partitionRegion(input)[23], 2);
    input.cost[22] = 0;
    assert.equal(partitionRegion(input)[23], 1);
  });

  test(`${mode}: flat plateaus use distance before deterministic label ties`, () => {
    const input = { ...plane(7, 1), mode, seeds: [{ index: 0, label: 9 }, { index: 6, label: 2 }] };
    const result = partitionRegion(input);
    assert.deepEqual([...result], [9, 9, 9, 2, 2, 2, 2]);
    assert.deepEqual(partitionRegion({ ...input, seeds: [...input.seeds].reverse() }), result);
  });

  test(`${mode}: neither neighbouring regions nor zero pixels are crossed`, () => {
    const input = { ...plane(7, 2), mode,
      regions: Int32Array.from([1, 1, 0, 2, 2, 3, 3, 1, 1, 0, 2, 2, 3, 3]),
      seeds: [{ index: 0, label: 8 }, { index: 3, label: 5 }, { index: 11, label: 7 }] };
    const result = partitionRegion(input);
    assert.deepEqual([...result.slice(0, 3)], [8, 8, 0]);
    for (const i of [3, 4, 10, 11]) assert.ok(result[i] === 5 || result[i] === 7);
    for (const i of [5, 6, 12, 13]) assert.equal(result[i], 0, 'unseeded region stays empty');
  });

  test(`${mode}: one label fills its region; no seeds leave all pixels empty`, () => {
    const input = { ...plane(5, 4), mode };
    assert.ok(partitionRegion(input).every(label => label === 0));
    assert.ok(partitionRegion({ ...input, seeds: [{ index: 12, label: 37 }] }).every(label => label === 37));
  });
}

test('colliding seeds choose the lower label independent of input order', () => {
  const input = { ...plane(3, 1), seeds: [{ index: 0, label: 7 }, { index: 0, label: 3 }, { index: 2, label: 8 }] };
  assert.deepEqual([...partitionRegion(input)], [3, 3, 8]);
  assert.deepEqual(partitionRegion(input), partitionRegion({ ...input, seeds: [...input.seeds].reverse() }));
});

test('input arrays and seed objects are never modified', () => {
  const input = { ...plane(8, 4), seeds: [{ index: 0, label: 1 }, { index: 31, label: 2 }] };
  input.cost[11] = 0.7;
  const snapshot = structuredClone(input);
  partitionRegion(input);
  assert.deepEqual(input, snapshot);
});

test('weighted geodesic ownership agrees with an independent all-pairs shortest-path oracle', () => {
  // Floyd-Warshall deliberately uses neither a queue nor the production
  // multi-source algorithm. Quarter-step inputs keep ties exact in binary.
  let random = 20260924;
  const next = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random; };
  for (let trial = 0; trial < 20; trial++) {
    const input = { ...plane(4, 4), penalty: 4,
      seeds: [{ index: 0, label: 7 }, { index: 3, label: 2 }, { index: 15, label: 9 }] };
    for (let i = 0; i < 16; i++) input.cost[i] = next() % 5 / 4;
    const distances = Array.from({ length: 16 }, () => new Float64Array(16).fill(Infinity));
    const hops = Array.from({ length: 16 }, () => new Float64Array(16).fill(Infinity));
    for (let a = 0; a < 16; a++) {
      distances[a]![a] = 0; hops[a]![a] = 0;
      for (let b = 0; b < 16; b++) {
        if (Math.abs(a % 4 - b % 4) + Math.abs(Math.floor(a / 4) - Math.floor(b / 4)) !== 1) continue;
        distances[a]![b] = 1 + 2 * (input.cost[a]! + input.cost[b]!);
        hops[a]![b] = 1;
      }
    }
    for (let k = 0; k < 16; k++) for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) {
      const distance = distances[a]![k]! + distances[k]![b]!;
      const count = hops[a]![k]! + hops[k]![b]!;
      if (distance < distances[a]![b]! || (distance === distances[a]![b] && count < hops[a]![b]!)) {
        distances[a]![b] = distance; hops[a]![b] = count;
      }
    }
    const expected = Int32Array.from({ length: 16 }, (_, pixel) => [...input.seeds].sort((a, b) =>
      distances[a.index]![pixel]! - distances[b.index]![pixel]!
      || hops[a.index]![pixel]! - hops[b.index]![pixel]!
      || a.label - b.label)[0]!.label);
    assert.deepEqual(partitionRegion(input), expected, `weighted trial ${trial}`);
  }
});

test('invalid costs, dimensions, region IDs, seeds and penalties fail clearly', () => {
  const input = plane(3, 1);
  assert.throws(() => partitionRegion({ ...input, height: 2 }), /dimensions/);
  assert.throws(() => partitionRegion({ ...input, cost: Float32Array.from([0, NaN, 0]) }), /costs/);
  assert.throws(() => partitionRegion({ ...input, cost: Float32Array.from([0, 1.1, 0]) }), /costs/);
  assert.throws(() => partitionRegion({ ...input, regions: Int32Array.from([1, -1, 1]) }), /Region IDs/);
  assert.throws(() => partitionRegion({ ...input, seeds: [{ index: 3, label: 1 }] }), /inside/);
  assert.throws(() => partitionRegion({ ...input, seeds: [{ index: 0, label: 0 }] }), /labels/);
  assert.throws(() => partitionRegion({ ...input, penalty: -1 }), /penalty/);
});
