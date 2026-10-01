import type { ArcEvidence, LineEvidence, Point } from './schema';
import { distance, EvidenceIndex, sub, wallBandSupport } from './wall-bands';
import type { WallBandSupport } from './wall-bands';

export const PORTAL_PRESET = Object.freeze({ version: 'joint-quarter-portal-v1', circleResidual: .02,
  attachmentResidual: .03, minimumSweepDegrees: 70, maximumSweepDegrees: 110,
  maximumAlignmentDegrees: 5, minimumWallContinuationGapWidths: 1,
  minimumWallThicknessGap: .04, maximumWallThicknessGap: .6 });
export const PORTAL_LIMITS = Object.freeze({ lines: 600_000, arcs: 10_000, points: 200_000, perArcPoints: 4096,
  candidates: 10_000, localEvidence: 256, work: 20_000_000, milliseconds: 60_000 });
type Limits = { [K in keyof typeof PORTAL_LIMITS]: number };

export type PortalWitness = {
  id: string; kind: 'single-swing' | 'double-swing'; ids: string[]; pathIds: string[];
  hinge: Point; latch: Point; hinges: Point[]; closure: [Point, Point];
  residuals: { circle: number; leaf: number; radiusGap: number; attachment: number; bandWidth: number };
  support: WallBandSupport & { arcIds: string[]; leafIds: string[]; radii: number[]; sweepsDegrees: number[] };
  calibratedConfidence: false; requiresReview: true;
};
type Fit = { arc: ArcEvidence; center: Point; radius: number; residual: number; sweep: number; ends: [Point, Point] };
type Swing = { fit: Fit; leaf: LineEvidence; closed: Point; leafResidual: number };

function fitArc(arc: ArcEvidence, guard: () => void): Fit | null {
  const ps = arc.points;
  if (ps.length < 8) return null;
  const origin = { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length };
  const pts = ps.map(p => sub(p, origin));
  let xx = 0, xy = 0, yy = 0, xz = 0, yz = 0;
  for (const p of pts) { guard(); const z = p.x * p.x + p.y * p.y; xx += p.x * p.x; xy += p.x * p.y; yy += p.y * p.y; xz += p.x * z; yz += p.y * z; }
  const det = xx * yy - xy * xy;
  if (!(det > 1e-12 * (xx + yy) ** 2)) return null;
  const center = { x: origin.x + .5 * (xz * yy - yz * xy) / det, y: origin.y + .5 * (yz * xx - xz * xy) / det };
  const radii = ps.map(p => distance(p, center)), radius = radii.reduce((a, b) => a + b, 0) / ps.length;
  if (!(radius > 0 && Number.isFinite(radius))) return null;
  const residual = Math.max(...radii.map(r => Math.abs(r - radius))) / radius;
  if (residual > PORTAL_PRESET.circleResidual) return null;
  let sweep = 0, sign = 0;
  for (let i = 1; i < ps.length; i++) {
    guard();
    const a = ps[i - 1]!, b = ps[i]!;
    let delta = Math.atan2(b.y - center.y, b.x - center.x) - Math.atan2(a.y - center.y, a.x - center.x);
    if (delta > Math.PI) delta -= 2 * Math.PI; if (delta < -Math.PI) delta += 2 * Math.PI;
    if (Math.abs(delta) > Math.PI / 9 || Math.abs(delta) < 1e-8 || (sign && Math.sign(delta) !== sign)) return null;
    sign = Math.sign(delta); sweep += delta;
  }
  const degrees = Math.abs(sweep) * 180 / Math.PI;
  if (degrees < PORTAL_PRESET.minimumSweepDegrees || degrees > PORTAL_PRESET.maximumSweepDegrees) return null;
  return { arc, center, radius, residual, sweep: degrees, ends: [ps[0]!, ps.at(-1)!] };
}

function leaves(fit: Fit, local: LineEvidence[], guard: () => void): Swing[] {
  const out: Swing[] = [];
  for (const leaf of local) {
    guard();
    if (!leaf.eligible || leaf.reasons.length) continue;
    for (const [tip, closed] of [[fit.ends[0], fit.ends[1]], [fit.ends[1], fit.ends[0]]] as const) {
      const error = Math.min(Math.max(distance(leaf.a, fit.center), distance(leaf.b, tip)), Math.max(distance(leaf.b, fit.center), distance(leaf.a, tip))) / fit.radius;
      if (error <= PORTAL_PRESET.attachmentResidual && Math.abs(distance(leaf.a, leaf.b) / fit.radius - 1) <= PORTAL_PRESET.attachmentResidual) out.push({ fit, leaf, closed, leafResidual: error });
    }
  }
  return out;
}

/** Geometric predicates only; never certified physical-room semantics. */
export function detectPortals(lines: LineEvidence[], arcs: ArcEvidence[], limits: Partial<Limits> = {}) {
  const budget: Limits = { ...PORTAL_LIMITS, ...limits }, started = performance.now();
  for (const key of Object.keys(budget) as (keyof Limits)[]) {
    if (!(Number.isFinite(budget[key]) && budget[key] > 0 && budget[key] <= PORTAL_LIMITS[key]) ||
      (key !== 'milliseconds' && !Number.isInteger(budget[key]))) throw new Error('invalid-resource-limit');
  }
  let work = 0;
  const check = () => {
    if (++work > budget.work) throw new Error('portal-work-budget');
    if (performance.now() - started > budget.milliseconds) throw new Error('portal-time-budget');
  };
  if (lines.length > budget.lines || arcs.length > budget.arcs || arcs.some(a => a.points.length > budget.perArcPoints) ||
    arcs.reduce((s, a) => s + a.points.length, 0) > budget.points) throw new Error('portal-input-budget');
  const evidence = new Map<string, LineEvidence | ArcEvidence>();
  for (const e of [...lines, ...arcs]) {
    check();
    if (!e.id || !e.pathId || evidence.has(e.id)) throw new Error('duplicate-or-missing-evidence-id');
    evidence.set(e.id, e);
    const points = 'points' in e ? e.points : [e.a, e.b];
    if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('nonfinite-evidence');
  }
  const unresolved: { arcIds: string[]; reason: string }[] = [], supported: PortalWitness[] = [];
  const fits: Fit[] = [];
  for (const arc of [...arcs].sort((a, b) => a.id.localeCompare(b.id))) {
    check();
    if (!arc.eligible || arc.reasons.length) { unresolved.push({ arcIds: [arc.id], reason: 'ineligible-source-state' }); continue; }
    const fit = fitArc(arc, check);
    if (fit) fits.push(fit); else unresolved.push({ arcIds: [arc.id], reason: 'not-intact-quarter-circle' });
  }
  const eligibleLines = lines.filter(l => { check(); return l.eligible && !l.reasons.length; }).sort((a, b) => a.id.localeCompare(b.id));
  const finish = (result: PortalWitness[], candidates: number) => { check(); return { supported: result, unresolved,
    reasonCounts: countReasons(unresolved), preset: PORTAL_PRESET, limits: budget,
    stats: { lines: lines.length, indexedLines: eligibleLines.length, arcs: arcs.length, candidates, work } }; };
  if (!fits.length) return finish([], 0);
  const radii = fits.map(f => f.radius).sort((a, b) => a - b), cell = radii[Math.floor(radii.length / 2)]!;
  const index = new EvidenceIndex(eligibleLines, cell, budget.localEvidence, check);
  const swings = fits.flatMap(f => { check(); const found = leaves(f, index.near(f.center, 1.1 * f.radius), check);
    if (!found.length) unresolved.push({ arcIds: [f.arc.id], reason: 'missing-radial-leaf' }); return found; });
  const centers = new EvidenceIndex(swings.map((s, i) => ({ id: `center-${i}`, pathId: s.fit.arc.pathId,
    a: s.fit.center, b: s.fit.center, eligible: true, reasons: [] })), cell, budget.localEvidence, check);
  let candidates = 0;
  const propose = (ss: Swing[], a: Point, b: Point) => {
    check(); if (++candidates > budget.candidates) throw new Error('portal-candidate-budget');
    const width = distance(a, b), scale = Math.min(...ss.map(s => s.fit.radius));
    if (!(width > 0)) return;
    const radiusGap = Math.abs(ss.reduce((sum, s) => sum + s.fit.radius, 0) - width) / width;
    if (radiusGap > PORTAL_PRESET.attachmentResidual) return;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const local = index.near(mid, 2 * width), excluded = new Set(ss.map(s => s.leaf.id));
    const proof = wallBandSupport(a, b, local, excluded, scale, check), support = proof.support;
    if (!support) { unresolved.push({ arcIds: ss.map(s => s.fit.arc.id), reason: proof.ambiguous ?
      'ambiguous-physical-wall-band' : 'missing-two-jambs-or-paired-wall-continuations' }); return; }
    const ids = [...new Set([...ss.flatMap(s => [s.fit.arc.id, s.leaf.id]), ...support.equivalentEvidenceIds])].sort();
    supported.push({ id: ids.join('|'), kind: ss.length === 1 ? 'single-swing' : 'double-swing', ids,
      pathIds: [...new Set(ids.map(id => evidence.get(id)!.pathId))].sort(), hinge: a, latch: b,
      hinges: ss.map(s => s.fit.center), closure: [a, b],
      residuals: { circle: Math.max(...ss.map(s => s.fit.residual)), leaf: Math.max(...ss.map(s => s.leafResidual)), radiusGap,
        attachment: support.attachmentResidual / scale, bandWidth: support.bandWidthResidual / scale },
      support: { ...support, arcIds: ss.map(s => s.fit.arc.id), leafIds: ss.map(s => s.leaf.id),
        radii: ss.map(s => s.fit.radius), sweepsDegrees: ss.map(s => s.fit.sweep) }, calibratedConfidence: false, requiresReview: true });
  };
  const seenPairs = new Set<string>();
  swings.forEach((s, i) => {
    propose([s], s.fit.center, s.closed);
    for (const p of centers.near(s.fit.center, 4.1 * s.fit.radius)) {
      check();
      const j = Number(p.id.slice(7)); if (j === i) continue; const t = swings[j]!;
      if (s.fit.arc.id === t.fit.arc.id || s.leaf.id === t.leaf.id) continue;
      const width = distance(s.fit.center, t.fit.center), tolerance = .03 * Math.min(s.fit.radius, t.fit.radius);
      if (Math.abs(width - s.fit.radius - t.fit.radius) > tolerance || distance(s.closed, t.closed) > tolerance) continue;
      const axis = sub(t.fit.center, s.fit.center), v = sub(s.closed, s.fit.center);
      if (Math.abs(axis.x * v.y - axis.y * v.x) / width > tolerance ||
        (axis.x * v.x + axis.y * v.y) / width <= 0 || (axis.x * v.x + axis.y * v.y) / width >= width) continue;
      const pairKey = [i, j].sort((a, b) => a - b).join(':');
      if (!seenPairs.has(pairKey)) { seenPairs.add(pairKey); propose([s, t], s.fit.center, t.fit.center); }
    }
  });
  // Local spatial comparisons only. Duplicated CAD paths aggregate evidence;
  // inconsistent shared swings/leaves or overlapping closures are quarantined.
  const raw = supported.sort((a, b) => a.id.localeCompare(b.id)), parents = raw.map((_, i) => i);
  const find = (i: number): number => { while (parents[i] !== i) { parents[i] = parents[parents[i]!]!; i = parents[i]!; } return i; };
  const rawIndex = new EvidenceIndex(raw.map((p, i) => ({ id: `raw-${i}`, pathId: p.id,
    a: p.hinge, b: p.latch, eligible: true, reasons: [] })), cell, budget.localEvidence, check);
  raw.forEach((p, i) => {
    const width = distance(p.hinge, p.latch), mid = { x: (p.hinge.x + p.latch.x) / 2, y: (p.hinge.y + p.latch.y) / 2 };
    for (const row of rawIndex.near(mid, width * .6)) {
      check(); const j = Number(row.id.slice(4)); if (j <= i) continue; const q = raw[j]!;
      if (closureDistance(p, q) <= .03 * Math.min(width, distance(q.hinge, q.latch))) parents[find(j)] = find(i);
    }
  });
  const groups = new Map<number, PortalWitness[]>();
  raw.forEach((p, i) => { const key = find(i); const group = groups.get(key) ?? []; group.push(p); groups.set(key, group); });
  const result: PortalWitness[] = [];
  for (const group of groups.values()) {
    if (group.length > budget.localEvidence) throw new Error('local-equivalence-budget');
    let inconsistent = false;
    for (const p of group) for (const q of group) { check();
      if (closureDistance(p, q) > .03 * Math.min(distance(p.hinge, p.latch), distance(q.hinge, q.latch))) inconsistent = true; }
    if (inconsistent) { unresolved.push({ arcIds: [...new Set(group.flatMap(p => p.support.arcIds))].sort(), reason: 'inconsistent-equivalent-closures' }); continue; }
    const p = group[0]!, ids = [...new Set(group.flatMap(q => q.ids))].sort(), arcsById = new Map<string, { radius: number; sweep: number }>();
    for (const q of group) q.support.arcIds.forEach((id, i) => arcsById.set(id, { radius: q.support.radii[i]!, sweep: q.support.sweepsDegrees[i]! }));
    const arcIds = [...arcsById.keys()].sort();
    result.push({ ...p, id: ids.join('|'), ids, pathIds: [...new Set(group.flatMap(q => q.pathIds))].sort(),
      support: { ...p.support, equivalentEvidenceIds: [...new Set(group.flatMap(q => q.support.equivalentEvidenceIds))].sort(),
        arcIds, leafIds: [...new Set(group.flatMap(q => q.support.leafIds))].sort(),
        radii: arcIds.map(id => arcsById.get(id)!.radius), sweepsDegrees: arcIds.map(id => arcsById.get(id)!.sweep) } });
  }
  const conflicts = new Set<PortalWitness>(), owners = new Map<string, PortalWitness[]>();
  for (const p of result) for (const id of [...p.support.arcIds, ...p.support.leafIds]) { check(); const list = owners.get(id) ?? []; list.push(p); owners.set(id, list); }
  for (const list of owners.values()) if (list.length > 1) for (const p of list) conflicts.add(p);
  const resultIndex = new EvidenceIndex(result.map((p, i) => ({ id: `result-${i}`, pathId: p.id,
    a: p.hinge, b: p.latch, eligible: true, reasons: [] })), cell, budget.localEvidence, check);
  result.forEach((p, i) => {
    const width = distance(p.hinge, p.latch), mid = { x: (p.hinge.x + p.latch.x) / 2, y: (p.hinge.y + p.latch.y) / 2 };
    for (const row of resultIndex.near(mid, width * .6)) { check(); const j = Number(row.id.slice(7)); if (j <= i) continue;
      const q = result[j]!; if (incompatibleClosures(p, q)) { conflicts.add(p); conflicts.add(q); } }
  });
  for (const p of conflicts) unresolved.push({ arcIds: p.support.arcIds, reason: 'conflicting-portal-evidence' });
  check();
  return finish(result.filter(p => !conflicts.has(p)), candidates);
}

function closureDistance(a: PortalWitness, b: PortalWitness) { return Math.min(Math.max(distance(a.hinge, b.hinge), distance(a.latch, b.latch)), Math.max(distance(a.hinge, b.latch), distance(a.latch, b.hinge))); }
function incompatibleClosures(a: PortalWitness, b: PortalWitness) {
  const u = sub(a.latch, a.hinge), v = sub(b.latch, b.hinge), w = sub(b.hinge, a.hinge);
  const cross = (x: Point, y: Point) => x.x * y.y - x.y * y.x, la = distance(a.hinge, a.latch), lb = distance(b.hinge, b.latch), tolerance = .03 * Math.min(la, lb);
  const det = cross(u, v);
  if (Math.abs(det) > 1e-8 * la * lb) {
    const t = cross(w, v) / det, s = cross(w, u) / det;
    return t > tolerance / la && t < 1 - tolerance / la && s > tolerance / lb && s < 1 - tolerance / lb;
  }
  if (Math.abs(cross(u, w)) / la > tolerance) return false;
  const x = (u.x * w.x + u.y * w.y) / la, end = x + (u.x * v.x + u.y * v.y) / la;
  return Math.min(la, Math.max(x, end)) - Math.max(0, Math.min(x, end)) > tolerance;
}
function countReasons(rows: { reason: string }[]) { return rows.reduce<Record<string, number>>((counts, r) => { counts[r.reason] = (counts[r.reason] ?? 0) + 1; return counts; }, {}); }
