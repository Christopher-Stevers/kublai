import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPortals, PORTAL_LIMITS, PORTAL_PRESET } from './portals';
import type { ArcEvidence, LineEvidence, Point } from './schema';

const line = (id: string, a: Point, b: Point): LineEvidence => ({ id, a, b, pathId: `path-${id}`, eligible: true, reasons: [] });
const arc = (id: string, center: Point, r: number, start = 0, end = Math.PI / 2): ArcEvidence => ({ id, pathId: `path-${id}`, eligible: true, reasons: [],
  points: Array.from({ length: 33 }, (_, i) => ({ x: center.x + r * Math.cos(start + (end - start) * i / 32), y: center.y + r * Math.sin(start + (end - start) * i / 32) })) });
type Fixture = { lines: LineEvidence[]; arcs: ArcEvidence[] };
function walls(width = 10, offset = -2): LineEvidence[] {
  return [line('h-face', { x: -2 * width, y: 0 }, { x: 0, y: 0 }), line('h-back', { x: -2 * width, y: offset }, { x: 0, y: offset }),
    line('l-face', { x: width, y: 0 }, { x: 3 * width, y: 0 }), line('l-back', { x: width, y: offset }, { x: 3 * width, y: offset }),
    line('h-jamb', { x: 0, y: 0 }, { x: 0, y: offset }), line('l-jamb', { x: width, y: 0 }, { x: width, y: offset })];
}
function single(): Fixture { return { lines: [...walls(), line('leaf', { x: 0, y: 0 }, { x: 0, y: 10 })], arcs: [arc('swing', { x: 0, y: 0 }, 10)] }; }
function double(r1 = 10, r2 = 10): Fixture {
  return { lines: [...walls(r1 + r2), line('leaf-left', { x: 0, y: 0 }, { x: 0, y: r1 }),
    line('leaf-right', { x: r1 + r2, y: 0 }, { x: r1 + r2, y: r2 })],
    arcs: [arc('swing-left', { x: 0, y: 0 }, r1), arc('swing-right', { x: r1 + r2, y: 0 }, r2, Math.PI, Math.PI / 2)] };
}
function transform(f: Fixture, fn: (p: Point) => Point): Fixture { return { lines: f.lines.map(l => ({ ...l, a: fn(l.a), b: fn(l.b) })), arcs: f.arcs.map(a => ({ ...a, points: a.points.map(fn) })) }; }
function near(p: Point, q: Point, epsilon = 1e-7) { assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < epsilon, `${JSON.stringify(p)} != ${JSON.stringify(q)}`); }
function assertRejected(f: Fixture, reason?: string) { const report = detectPortals(f.lines, f.arcs); assert.equal(report.supported.length, 0); if (reason) assert.ok(report.reasonCounts[reason]); return report; }

test('quarter swing uses fitted center and two jambs plus continuing paired faces', () => {
  const f = single(), report = detectPortals(f.lines, f.arcs), p = report.supported[0]!;
  assert.equal(report.supported.length, 1); assert.equal(p.kind, 'single-swing'); near(p.hinge, { x: 0, y: 0 }); near(p.latch, { x: 10, y: 0 });
  assert.deepEqual(p.support.jambIds, ['h-jamb', 'l-jamb']); assert.equal(p.support.wallFaceIds.length, 4);
  assert.equal(p.requiresReview, true); assert.equal(p.calibratedConfidence, false); assert.equal(p.ids.length, 8);
  assert.equal(p.pathIds.length, 8); assert.ok(p.residuals.circle < 1e-12); assert.equal(report.stats.indexedLines, 7);
});
test('paired doors close between two true centers, never each half opening', () => {
  const f = double(), p = detectPortals(f.lines, f.arcs).supported;
  assert.equal(p.length, 1); assert.equal(p[0]!.kind, 'double-swing'); assert.deepEqual(p[0]!.support.arcIds.sort(), ['swing-left', 'swing-right']);
  assert.equal(p[0]!.support.leafIds.length, 2); assert.ok(Math.abs(Math.hypot(p[0]!.hinge.x - p[0]!.latch.x, p[0]!.hinge.y - p[0]!.latch.y) - 20) < 1e-8);
});
test('unequal paired leaves are found by larger-radius local query regardless of ID order', () => {
  const f = double(2, 10); assert.equal(detectPortals(f.lines, f.arcs).supported.length, 1);
});
test('uniform transforms, reflections and endpoint/arc reversal preserve closure', () => {
  for (const scale of [.1, 1, 1000]) for (const angle of [0, .37, 1.57, 3.4]) for (const reflection of [1, -1]) {
    const fn = (p: Point) => ({ x: 100 + scale * (p.x * Math.cos(angle) - reflection * p.y * Math.sin(angle)), y: -37 + scale * (p.x * Math.sin(angle) + reflection * p.y * Math.cos(angle)) });
    const f = transform(single(), fn); f.lines = f.lines.reverse().map(l => ({ ...l, a: l.b, b: l.a })); f.arcs[0]!.points.reverse();
    const p = detectPortals(f.lines, f.arcs).supported; assert.equal(p.length, 1); near(p[0]!.hinge, fn({ x: 0, y: 0 }), 1e-5); near(p[0]!.latch, fn({ x: 10, y: 0 }), 1e-5);
  }
});
test('quarter cubic approximation accepted, preserving original path IDs', () => {
  const f = single(), k = .5522847498307936;
  f.arcs[0]!.points = Array.from({ length: 33 }, (_, i) => { const t = i / 32, a = 1 - t; return { x: 10 * (a ** 3 + 3 * a * a * t + 3 * a * t * t * k), y: 10 * (3 * a * a * t * k + 3 * a * t * t + t ** 3) }; });
  const p = detectPortals(f.lines, f.arcs).supported; assert.equal(p.length, 1); assert.ok(p[0]!.pathIds.includes('path-swing'));
});
test('missing radial leaf cannot be replaced by quarter-circle chord', () => {
  const f = single(); f.lines = f.lines.filter(l => l.id !== 'leaf'); f.lines.push(line('chord', { x: 10, y: 0 }, { x: 0, y: 10 }));
  assertRejected(f, 'missing-radial-leaf');
});
test('leaf offset from true circle center beyond 3 percent is unresolved', () => {
  const f = single(); f.lines.at(-1)!.a = { x: .5, y: 0 }; assertRejected(f, 'missing-radial-leaf');
});
for (const missing of ['h-jamb', 'l-jamb', 'h-face', 'h-back', 'l-face', 'l-back']) test(`missing independent ${missing} cannot certify`, () => {
  const f = single(); f.lines = f.lines.filter(l => l.id !== missing); assertRejected(f, 'missing-two-jambs-or-paired-wall-continuations');
});
test('short furniture frame plus matching arc and leaf lacks continuing host bands', () => {
  const f = single(); f.lines = f.lines.map(l => l.id.startsWith('h-') && !l.id.endsWith('jamb') ? { ...l, a: { x: -5, y: l.a.y } } : l.id.startsWith('l-') && !l.id.endsWith('jamb') ? { ...l, b: { x: 15, y: l.b.y } } : l);
  assertRejected(f, 'missing-two-jambs-or-paired-wall-continuations');
});
test('half-door adjacent to wide hall is not a radius-matched full portal', () => {
  const f = single(); f.lines = [...walls(20), f.lines.at(-1)!]; assertRejected(f);
});
test('detached latch return is not a wall-chain endpoint', () => {
  const f = single(); f.lines.find(l => l.id === 'l-jamb')!.a.x += 1; f.lines.find(l => l.id === 'l-jamb')!.b.x += 1; assertRejected(f);
});
test('single or mismatched wall bands cannot be completed from arbitrary parallel strokes', () => {
  const f = single(); f.lines.find(l => l.id === 'l-back')!.a.y = -3; f.lines.find(l => l.id === 'l-back')!.b.y = -3; assertRejected(f);
});
test('wall alignment beyond 5 degrees rejects the alleged host face', () => {
  const f = single(); f.lines.find(l => l.id === 'h-back')!.a.y += 4; assertRejected(f);
});
test('ambiguous opposite physical wall bands remain unresolved', () => {
  const f = single(); f.lines.push(...walls(10, 2).filter(l => l.id.endsWith('back') || l.id.endsWith('jamb')).map(l => ({ ...l, id: `other-${l.id}`, pathId: `other-${l.pathId}` })));
  assertRejected(f, 'ambiguous-physical-wall-band');
});
test('cloud loops, half circles, zigzags and noncircular arcs cannot become doors', () => {
  for (const a of [arc('bad', { x: 0, y: 0 }, 10, 0, Math.PI), arc('bad', { x: 0, y: 0 }, 10, 0, 2 * Math.PI),
    { ...arc('bad', { x: 0, y: 0 }, 10), points: arc('temp', { x: 0, y: 0 }, 10).points.map((p, i) => ({ x: p.x + (i % 2 ? 2 : 0), y: p.y })) }]) {
    const f = single(); f.arcs = [a]; assertRejected(f, 'not-intact-quarter-circle');
  }
});
test('unknown nonuniform transform, clipping or source state stays ineligible', () => {
  for (const target of ['swing', 'leaf', 'h-jamb', 'h-back']) { const f = single(); const e = [...f.lines, ...f.arcs].find(e => e.id === target)!;
    e.eligible = false; e.reasons = ['nonuniform-or-unknown-source-state']; assertRejected(f); }
  const f = single(); f.arcs[0]!.reasons = ['unsupported-clip']; assertRejected(f, 'ineligible-source-state');
});
test('duplicated CAD arc/leaf and wall evidence deduplicates without losing provenance', () => {
  const f = single(); f.arcs.push({ ...f.arcs[0]!, id: 'duplicate-swing', pathId: 'duplicate-swing-path' });
  f.lines.push(...f.lines.map(l => ({ ...l, id: `duplicate-${l.id}`, pathId: `duplicate-${l.pathId}` })));
  const report = detectPortals(f.lines, f.arcs), p = report.supported[0]!; assert.equal(report.supported.length, 1);
  assert.equal(p.support.arcIds.length, 2); assert.equal(p.support.leafIds.length, 2); assert.equal(p.ids.length, 16);
  assert.ok(p.pathIds.includes('duplicate-swing-path')); assert.deepEqual(detectPortals([...f.lines].reverse(), [...f.arcs].reverse()), report);
});
test('incompatible use of one quarter swing is quarantined, not first-fit selected', () => {
  const f = single(); const g = transform(single(), p => ({ x: -p.y, y: p.x }));
  // One arc can connect to either endpoint: add a second radial leaf and hosts
  // for the vertical closure, using the same arc provenance.
  f.lines.push(...g.lines.map(l => ({ ...l, id: `vertical-${l.id}`, pathId: `vertical-${l.pathId}` })));
  f.lines.push(line('closed-leaf', { x: 0, y: 0 }, { x: 10, y: 0 }));
  assertRejected(f, 'conflicting-portal-evidence');
});
test('crossing independently supported portal closures are unresolved', () => {
  const a = single(), b = transform(single(), p => ({ x: 5 - p.y, y: p.x - 5 }));
  b.lines = b.lines.map(l => ({ ...l, id: `cross-${l.id}`, pathId: `cross-${l.pathId}` })); b.arcs = b.arcs.map(a => ({ ...a, id: `cross-${a.id}`, pathId: `cross-${a.pathId}` }));
  assertRejected({ lines: [...a.lines, ...b.lines], arcs: [...a.arcs, ...b.arcs] }, 'conflicting-portal-evidence');
});
test('resource limits explicitly fail instead of partial/truncated evidence', () => {
  const f = single();
  assert.throws(() => detectPortals(f.lines, f.arcs, { lines: 1 }), /portal-input-budget/);
  assert.throws(() => detectPortals(f.lines, f.arcs, { perArcPoints: 8 }), /portal-input-budget/);
  assert.throws(() => detectPortals(f.lines, f.arcs, { points: 8 }), /portal-input-budget/);
  assert.throws(() => detectPortals(f.lines, f.arcs, { localEvidence: 1 }), /local-evidence-budget/);
  assert.throws(() => detectPortals(f.lines, f.arcs, { work: 1 }), /portal-work-budget/);
  assert.throws(() => detectPortals(f.lines, f.arcs, { milliseconds: 1e-9 }), /portal-time-budget/);
  const paired = double(); assert.throws(() => detectPortals(paired.lines, paired.arcs, { candidates: 1 }), /portal-candidate-budget/);
});
test('budget can only be tightened and all discrete limits must be finite integers', () => {
  const f = single(); for (const limits of [{ work: Infinity }, { arcs: 1.5 }, { lines: PORTAL_LIMITS.lines + 1 }, { milliseconds: NaN }, { madeUp: 1 }])
    assert.throws(() => detectPortals(f.lines, f.arcs, limits), /invalid-resource-limit/);
});
test('duplicate IDs and nonfinite points fail before geometric reasoning', () => {
  const f = single(); assert.throws(() => detectPortals([...f.lines, f.lines[0]!], f.arcs), /duplicate-or-missing-evidence-id/);
  f.arcs[0]!.points[0]!.x = NaN; assert.throws(() => detectPortals(f.lines, f.arcs), /nonfinite-evidence/);
});
test('ineligible page inventory is reported but never spatially indexed', () => {
  const f = single(); f.lines.push(...Array.from({ length: 1000 }, (_, i) => ({ ...line(`annotation-${i}`, { x: 0, y: 0 }, { x: 10, y: 0 }), eligible: false, reasons: ['colored-revision-cloud'] })));
  const r = detectPortals(f.lines, f.arcs); assert.equal(r.supported.length, 1); assert.equal(r.stats.lines, 1007); assert.equal(r.stats.indexedLines, 7);
});
test('finite coordinates with unrepresentable grid cells fail before index enumeration', () => {
  const f = single(); f.lines.push(line('far-finite', { x: 1e300, y: 1 }, { x: 1e300, y: 2 }));
  assert.throws(() => detectPortals(f.lines, f.arcs), /index-coordinate-budget/);
});
test('preset exposes fixed preregistered geometry gates and review status', () => {
  assert.equal(PORTAL_PRESET.circleResidual, .02); assert.equal(PORTAL_PRESET.attachmentResidual, .03);
  assert.equal(PORTAL_PRESET.minimumSweepDegrees, 70); assert.equal(PORTAL_PRESET.maximumSweepDegrees, 110); assert.equal(PORTAL_PRESET.maximumAlignmentDegrees, 5);
});
