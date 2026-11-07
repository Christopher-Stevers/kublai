import assert from 'node:assert/strict';
import test from 'node:test';
import { LOW_BOUNDARY_EVIDENCE, summarizePartitions } from './partition-diagnostics';
import type { PartitionDiagnosticOptions } from './partition-diagnostics';

const plane = (width: number, height: number): PartitionDiagnosticOptions => ({
  width, height, labels: new Int32Array(width * height),
  regions: new Int32Array(width * height).fill(1),
  cost: new Float32Array(width * height), seeds: [],
});

test('empty prediction and seeds produce empty diagnostics', () => {
  assert.deepEqual(summarizePartitions(plane(3, 2)), {
    boundaries: [], rooms: [], duplicateSeedPixels: [],
  });
});

test('unchanged room reports total area including grown components without invented boundaries', () => {
  const input = { ...plane(4, 2), labels: new Int32Array(8).fill(7),
    regions: Int32Array.from([1, 1, 2, 2, 1, 1, 2, 2]),
    seeds: [{ seedIndex: 4, index: 0, label: 7, component: 1, nudgeDistance: 2.5 }] };
  assert.deepEqual(summarizePartitions(input), { boundaries: [], duplicateSeedPixels: [],
    rooms: [{ label: 7, seedIndex: 4, area: 8, component: 1, nudgeDistance: 2.5,
      seedRetained: true, collidingSeedPixel: false }] });
});

test('weak and strong inferred boundaries use edge averages and always require review', () => {
  const input = { ...plane(2, 3), labels: Int32Array.from([9, 3, 9, 3, 9, 3]),
    cost: Float32Array.from([0, 0, 0.01, 0.03, 0.5, 1]) };
  const [boundary] = summarizePartitions(input).boundaries;
  assert.ok(boundary);
  assert.deepEqual(boundary.labels, [3, 9]);
  assert.equal(boundary.length, 3, 'each contact edge is counted once');
  assert.ok(Math.abs(boundary.meanBarrier - (0 + 0.02 + 0.75) / 3) < 1e-8);
  assert.equal(boundary.lowEvidenceFraction, 2 / 3);
  assert.equal(boundary.needsReview, true);
  input.cost.fill(0.75);
  const strong = summarizePartitions(input).boundaries[0]!;
  assert.equal(strong.lowEvidenceFraction, 0);
  assert.equal(strong.needsReview, true, 'density never certifies the inferred boundary');
  assert.equal(LOW_BOUNDARY_EVIDENCE, 0.03);
});

test('contacts across regions or zero pixels and row wrapping are excluded', () => {
  const input = { ...plane(3, 2),
    labels: Int32Array.from([1, 2, 3, 4, 0, 5]),
    regions: Int32Array.from([1, 2, 0, 3, 2, 4]) };
  assert.deepEqual(summarizePartitions(input).boundaries, []);
});

test('vertical contacts contribute and distinct pairs are ordered numerically', () => {
  const input = { ...plane(3, 2), labels: Int32Array.from([12, 12, 12, 2, 3, 3]) };
  assert.deepEqual(summarizePartitions(input).boundaries, [
    { labels: [2, 3], length: 1, meanBarrier: 0, lowEvidenceFraction: 1, needsReview: true },
    { labels: [2, 12], length: 1, meanBarrier: 0, lowEvidenceFraction: 1, needsReview: true },
    { labels: [3, 12], length: 2, meanBarrier: 0, lowEvidenceFraction: 1, needsReview: true },
  ]);
});

test('colliding seeds expose the dropped label and do not depend on seed input order', () => {
  const input = { ...plane(3, 1), labels: Int32Array.from([2, 2, 8]), seeds: [
    { seedIndex: 9, index: 0, label: 5, component: 1 },
    { seedIndex: 3, index: 0, label: 2, component: 1 },
    { seedIndex: 7, index: 2, label: 8, component: 1 },
  ] };
  const result = summarizePartitions(input);
  assert.deepEqual(result.duplicateSeedPixels, [{ index: 0, seedIndices: [3, 9], labels: [2, 5] }]);
  assert.deepEqual(result.rooms.map(r => [r.seedIndex, r.area, r.seedRetained, r.collidingSeedPixel]), [
    [3, 2, true, true], [7, 1, true, false], [9, 0, false, true],
  ]);
  assert.deepEqual(summarizePartitions({ ...input, seeds: [...input.seeds].reverse() }), result);
});

test('input arrays and seed objects are unchanged', () => {
  const input = { ...plane(2, 2), labels: Int32Array.from([1, 1, 2, 2]), seeds: [
    { seedIndex: 4, index: 0, label: 1, component: 1 },
    { seedIndex: 1, index: 3, label: 2, component: 1 },
  ] };
  const snapshot = structuredClone(input);
  summarizePartitions(input);
  assert.deepEqual(input, snapshot);
});

test('invalid dimensions, costs, IDs and seed positions fail clearly', () => {
  const input = plane(2, 1);
  const seed = { seedIndex: 0, index: 0, label: 1, component: 1 };
  assert.throws(() => summarizePartitions({ ...input, width: 0 }), /dimensions/);
  assert.throws(() => summarizePartitions({ ...input, height: 2 }), /dimensions/);
  assert.throws(() => summarizePartitions({ ...input, cost: Float32Array.from([NaN, 0]) }), /costs/);
  assert.throws(() => summarizePartitions({ ...input, cost: Float32Array.from([0, 1.01]) }), /costs/);
  assert.throws(() => summarizePartitions({ ...input, labels: Int32Array.from([-1, 0]) }), /nonnegative/);
  assert.throws(() => summarizePartitions({ ...input, regions: Int32Array.from([-1, 0]) }), /nonnegative/);
  assert.throws(() => summarizePartitions({ ...input, seeds: [{ ...seed, component: 2 }] }), /component/);
  assert.throws(() => summarizePartitions({ ...input, seeds: [{ ...seed, index: 2 }] }), /component/);
  assert.throws(() => summarizePartitions({ ...input, seeds: [{ ...seed, label: 0 }] }), /labels/);
  assert.throws(() => summarizePartitions({ ...input, seeds: [{ ...seed, nudgeDistance: -1 }] }), /nudge/);
  assert.throws(() => summarizePartitions({ ...input, seeds: [seed, { ...seed, index: 1 }] }), /distinct/);
});
