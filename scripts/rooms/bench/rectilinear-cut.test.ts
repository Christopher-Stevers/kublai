import assert from 'node:assert/strict';
import test from 'node:test';
import { refineByNarrowCut } from './rectilinear-cut';
import type { CutSeed } from './rectilinear-cut';

function fixture(width = 20, height = 12) {
  const regions = new Int32Array(width * height);
  // Large left chamber with a small lower-right extension. Its four-pixel
  // opening starts at a real outline corner, independent of seed midpoints.
  for (let y = 1; y < 11; y++) for (let x = 1; x < 18; x++) {
    if (x < 11 || y >= 7) regions[y * width + x] = 1;
  }
  const labels = Int32Array.from(regions, n => n ? 99 : 0);
  const seeds: CutSeed[] = [
    { index: 5 * width + 4, label: 7, component: 1 },
    { index: 9 * width + 15, label: 3, component: 1 },
  ];
  return { width, height, regions, labels, seeds };
}

test('L-shaped shared space cuts at its corner, not inside the flat narrow chamber', () => {
  const input = fixture();
  const { labels, cuts } = refineByNarrowCut(input);
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0]!.axis, 'x');
  assert.equal(cuts[0]!.position, 11);
  assert.equal(cuts[0]!.opening, 4);
  assert.equal(cuts[0]!.needsReview, true);
  for (let i = 0; i < labels.length; i++) {
    assert.equal(labels[i], input.regions[i] ? i % input.width < 11 ? 7 : 3 : 0);
  }
});

test('transposing the drawing transposes the proposed cut and pixel ownership', () => {
  const input = fixture(), result = refineByNarrowCut(input);
  const flip = (i: number) => (i % input.width) * input.height + Math.floor(i / input.width);
  const regions = new Int32Array(input.regions.length), labels = new Int32Array(input.labels.length);
  for (let i = 0; i < regions.length; i++) { regions[flip(i)] = input.regions[i]!; labels[flip(i)] = input.labels[i]!; }
  const rotated = refineByNarrowCut({ width: input.height, height: input.width, regions, labels,
    seeds: input.seeds.map(s => ({ ...s, index: flip(s.index) })) });
  assert.equal(rotated.cuts.length, 1);
  assert.equal(rotated.cuts[0]!.axis, 'y');
  assert.equal(rotated.cuts[0]!.position, result.cuts[0]!.position);
  for (let i = 0; i < regions.length; i++) assert.equal(rotated.labels[flip(i)], result.labels[i]);
});

test('a plain open rectangle is preserved because it supplies no narrow-corner evidence', () => {
  const input = fixture();
  input.regions.fill(1);
  const result = refineByNarrowCut(input);
  assert.deepEqual(result.labels, input.labels);
  assert.deepEqual(result.cuts, []);
  assert.notEqual(result.labels, input.labels, 'the returned labels are always a copy');
});

test('three seeds, coincident seeds, and invalid seeds preserve existing partition', () => {
  const input = fixture();
  for (const seeds of [
    [...input.seeds, { index: 2 * input.width + 2, label: 4, component: 1 }],
    [input.seeds[0]!, { ...input.seeds[1]!, index: input.seeds[0]!.index }],
    [input.seeds[0]!, { ...input.seeds[1]!, index: 0 }],
  ]) {
    const result = refineByNarrowCut({ ...input, seeds });
    assert.deepEqual(result.labels, input.labels);
    assert.deepEqual(result.cuts, []);
  }
});

test('a disconnected pocket on either side rejects a cut instead of inventing ownership', () => {
  const input = fixture();
  // Deliberately malformed component ID: an isolated pocket shares its ID.
  // The profile still presents a strong corner, but connectivity must reject it.
  input.regions[2 * input.width + 15] = 1;
  input.labels[2 * input.width + 15] = 99;
  const result = refineByNarrowCut(input);
  assert.deepEqual(result.labels, input.labels);
  assert.deepEqual(result.cuts, []);
});

test('two openings around a wall stub cannot become one supported straight cut', () => {
  const input = fixture();
  input.regions.fill(0);
  for (let y = 1; y < 11; y++) for (let x = 1; x < 18; x++) {
    if (x !== 10 || y < 4 || y > 6) input.regions[y * input.width + x] = 1;
  }
  input.labels = Int32Array.from(input.regions, n => n ? 99 : 0);
  input.seeds[1]!.index = 5 * input.width + 15;
  const result = refineByNarrowCut(input);
  assert.deepEqual(result.labels, input.labels);
  assert.deepEqual(result.cuts, []);
});

test('a narrow sliver cannot become an inferred room', () => {
  const input = fixture();
  for (let y = 7; y < 11; y++) for (let x = 12; x < 18; x++) {
    input.regions[y * input.width + x] = 0;
    input.labels[y * input.width + x] = 0;
  }
  input.seeds[1]!.index = 9 * input.width + 11;
  const result = refineByNarrowCut(input);
  assert.deepEqual(result.labels, input.labels);
  assert.deepEqual(result.cuts, []);
});

test('seed order and label numbers do not move the geometric cut', () => {
  const input = fixture();
  const original = refineByNarrowCut(input);
  const reversed = refineByNarrowCut({ ...input, seeds: [...input.seeds].reverse() });
  assert.deepEqual(reversed, original);
});

test('input arrays and seed objects remain unchanged', () => {
  const input = fixture(), snapshot = structuredClone(input);
  refineByNarrowCut(input);
  assert.deepEqual(input, snapshot);
});
