import type { LineEvidence, Point } from './schema';

export const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Bounded grid index; exceeding a limit fails instead of truncating evidence. */
export class EvidenceIndex {
  private cells = new Map<string, number[]>();
  private entries = 0;
  private guard: () => void;
  constructor(readonly lines: LineEvidence[], readonly cell: number, readonly maxLocal = 256, guard: () => void = () => {}) {
    this.guard = guard;
    if (!(cell > 0 && Number.isFinite(cell))) throw new Error('invalid-index-scale');
    lines.forEach((s, i) => {
      guard();
      const keys = this.keys(Math.min(s.a.x, s.b.x), Math.min(s.a.y, s.b.y), Math.max(s.a.x, s.b.x), Math.max(s.a.y, s.b.y));
      if (this.entries + keys.length > 1_000_000) throw new Error('index-budget');
      for (const k of keys) { const ids = this.cells.get(k) ?? []; ids.push(i); this.cells.set(k, ids); }
      this.entries += keys.length;
    });
  }
  private keys(x0: number, y0: number, x1: number, y1: number): string[] {
    const a = Math.floor(x0 / this.cell), b = Math.floor(x1 / this.cell);
    const c = Math.floor(y0 / this.cell), d = Math.floor(y1 / this.cell);
    // A finite source coordinate divided by a tiny cell can overflow or cease
    // to increment in a JS number loop. Fail before enumerating those cells.
    if (![a, b, c, d].every(Number.isSafeInteger)) throw new Error('index-coordinate-budget');
    if ((b - a + 1) * (d - c + 1) > 4096) throw new Error('index-query-budget');
    const out: string[] = [];
    for (let x = a; x <= b; x++) for (let y = c; y <= d; y++) out.push(`${x}:${y}`);
    return out;
  }
  near(p: Point, radius: number): LineEvidence[] {
    const ids = new Set<number>();
    for (const k of this.keys(p.x - radius, p.y - radius, p.x + radius, p.y + radius)) {
      for (const i of this.cells.get(k) ?? []) { this.guard(); ids.add(i); if (ids.size > this.maxLocal) throw new Error('local-evidence-budget'); }
    }
    return [...ids].sort((a, b) => a - b).map(i => this.lines[i]!);
  }
}

export type WallBandSupport = {
  jambIds: [string, string]; wallFaceIds: [string, string, string, string];
  thickness: number; attachmentResidual: number; bandWidthResidual: number;
  equivalentEvidenceIds: string[];
};
export type WallBandSearch = { support: WallBandSupport | null; ambiguous: boolean };
type LocalEnd = { line: LineEvidence; near: Point; z: number; attachment: number };
type Return = { line: LineEvidence; z: number; faces: [LocalEnd, LocalEnd]; evidenceIds: string[]; attachment: number };

/**
 * Four continuing face pieces and two independent spanning returns. Searches
 * are local and operation-guarded. Multiple incompatible physical bands are
 * unresolved; duplicated painted strokes only add provenance.
 */
export function wallBandSupport(hinge: Point, latch: Point, candidates: LineEvidence[], excluded: Set<string>,
  attachmentScale: number, guard: () => void): WallBandSearch {
  const width = distance(hinge, latch), tolerance = .03 * attachmentScale;
  if (!(width > 0 && attachmentScale > 0)) return { support: null, ambiguous: false };
  const u = { x: (latch.x - hinge.x) / width, y: (latch.y - hinge.y) / width };
  const n = { x: -u.y, y: u.x }, angular = Math.sin(5 * Math.PI / 180);
  const rows = candidates.filter(s => s.eligible && s.reasons.length === 0 && !excluded.has(s.id))
    .sort((a, b) => a.id.localeCompare(b.id)).map(s => {
      guard();
      return { s, a: { t: dot(sub(s.a, hinge), u), z: dot(sub(s.a, hinge), n) },
        b: { t: dot(sub(s.b, hinge), u), z: dot(sub(s.b, hinge), n) }, length: distance(s.a, s.b) };
    });
  const returns: Return[][] = [];
  for (const [index, at] of [0, width].entries()) {
    const faces: LocalEnd[] = [];
    const jambs: { line: LineEvidence; near: Point; far: Point; z: number }[] = [];
    for (const row of rows) {
      guard();
      if (!row.length) continue;
      if (Math.abs(row.b.z - row.a.z) / row.length <= angular) {
        const nearA = Math.abs(row.a.t - at) <= Math.abs(row.b.t - at);
        const near = nearA ? row.a : row.b, far = nearA ? row.b : row.a;
        if (Math.abs(near.t - at) <= tolerance && (index === 0 ? far.t <= at - width : far.t >= at + width)) {
          faces.push({ line: row.s, near: nearA ? row.s.a : row.s.b, z: near.z, attachment: Math.abs(near.t - at) });
        }
      }
      if (Math.abs(row.b.t - row.a.t) / row.length <= angular &&
        Math.max(Math.abs(row.a.t - at), Math.abs(row.b.t - at)) <= tolerance) {
        const nearA = Math.abs(row.a.z) <= Math.abs(row.b.z), near = nearA ? row.a : row.b, far = nearA ? row.b : row.a;
        if (Math.hypot(near.t - at, near.z) <= tolerance && Math.abs(far.z) >= .04 * width && Math.abs(far.z) <= .6 * width) {
          jambs.push({ line: row.s, near: nearA ? row.s.a : row.s.b, far: nearA ? row.s.b : row.s.a, z: far.z });
        }
      }
    }
    const endReturns: Return[] = [];
    for (const j of jambs) {
      const base: LocalEnd[] = [], offset: LocalEnd[] = [];
      for (const face of faces) {
        guard();
        if (face.line.id === j.line.id) continue;
        if (distance(face.near, j.near) <= tolerance) base.push(face);
        if (distance(face.near, j.far) <= tolerance) offset.push(face);
      }
      // Canonical IDs choose among geometrically equivalent strokes; neither
      // wall thickness nor closure is selected from an incompatible branch.
      if (base.length && offset.length && base[0]!.line.id !== offset[0]!.line.id) {
        endReturns.push({ line: j.line, z: j.z, faces: [base[0]!, offset[0]!],
          evidenceIds: [...base, ...offset].map(f => f.line.id).concat(j.line.id),
          attachment: Math.max(distance(base[0]!.near, j.near), distance(offset[0]!.near, j.far),
            distance(j.near, index === 0 ? hinge : latch)) });
      }
    }
    returns.push(endReturns);
  }
  const found: WallBandSupport[] = [];
  for (const h of returns[0]!) for (const l of returns[1]!) {
    guard();
    if (Math.abs(h.z - l.z) > tolerance) continue;
    const faceIds = [...h.faces, ...l.faces].map(f => f.line.id);
    if (new Set([...faceIds, h.line.id, l.line.id]).size !== 6) continue;
    found.push({ jambIds: [h.line.id, l.line.id], wallFaceIds: faceIds as WallBandSupport['wallFaceIds'],
      thickness: (Math.abs(h.z) + Math.abs(l.z)) / 2,
      attachmentResidual: Math.max(h.attachment, l.attachment),
      bandWidthResidual: Math.abs(h.z - l.z), equivalentEvidenceIds: [...new Set([...h.evidenceIds, ...l.evidenceIds])].sort() });
    if (found.length > 256) throw new Error('local-wall-support-budget');
  }
  if (!found.length) return { support: null, ambiguous: false };
  const first = found[0]!;
  // Opposite-sided or different-width bands cannot become an arbitrary proof.
  for (const f of found) {
    guard();
    const h = rows.find(r => r.s.id === f.jambIds[0])!, base = rows.find(r => r.s.id === first.jambIds[0])!;
    const z = Math.abs(h.a.z) > Math.abs(h.b.z) ? h.a.z : h.b.z;
    const bz = Math.abs(base.a.z) > Math.abs(base.b.z) ? base.a.z : base.b.z;
    if (Math.abs(z - bz) > tolerance) return { support: null, ambiguous: true };
  }
  return { support: { ...first, equivalentEvidenceIds: [...new Set(found.flatMap(f => f.equivalentEvidenceIds))].sort() }, ambiguous: false };
}
