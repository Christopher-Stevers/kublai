import type { PdfLabel } from "../pdf-walls";

/**
 * Architectural room tags: the number an architect gives each room/space
 * (A-118, B-S105, C-121a, 104, L2-07). On construction drawings this is the
 * authoritative room list: one tag per room, printed under the room's name.
 * The same numbers reappear as door tags (usually with a letter suffix, in
 * ovals at the wall), which have no room name directly above them.
 */
const TAG = /^(?:[A-Z]{1,3}\d?[-.]?)?S?\d{2,4}[a-z]?$/;
const NOT_A_NAME =
  /^(?:rated|typ\.?|typical|sim\.?|similar|up|dn|down|n\.?t\.?s\.?|marketing|\d.*|[A-Z]{1,3}\d{2,4}|[\d\s./-]+)$/i;
/** Occupancy descriptions sit near suite tags but describe the unit. */
const OCCUPANCY = /^\d+\s*bed(room)?s?\b|^studio\b|^\d+\s*bd\b/i;

export type RoomTagSeed = {
  x: number;
  y: number;
  name: string;
  tag: string;
  title: string;
  kind: "tagged";
};

function textHeight(label: PdfLabel) {
  const a = label.anchors?.[0];
  const b = label.anchors?.[1];
  // Anchors run along the text; use run length / characters as a size proxy.
  const run = a && b ? Math.hypot(b.x - a.x, b.y - a.y) / 0.8 : 0.004;
  return Math.max(0.0015, run / Math.max(2, label.name.length) * 1.6);
}

/**
 * Finds room tags with a room name directly above. Each becomes one room seed
 * placed between name and tag (inside the room). Door tags, sheet references
 * and stray numbers have no name above and are ignored.
 */
export function findRoomTagSeeds(labels: PdfLabel[], aspect = 1): RoomTagSeed[] {
  // Title block / margins: sheet numbers and drawing titles are not rooms.
  const onPlan = (l: PdfLabel) => l.x > 0.025 && l.x < 0.92 && l.y > 0.025 && l.y < 0.96;
  const candidates = labels.filter((l) => TAG.test(l.name.trim()) && onPlan(l));
  const names = labels.filter(
    (l) => /[A-Za-z]{2}/.test(l.name) && !NOT_A_NAME.test(l.name.trim()) && !OCCUPANCY.test(l.name.trim()) && !/^[A-Z]{1,4}\d+$/.test(l.name.trim()) && onPlan(l),
  );
  /** Offset of `l` from `ref` in ref's text frame: along the text, and down the page as read. */
  const local = (ref: PdfLabel, l: PdfLabel) => {
    // Text angle is measured with y up; page y runs down. Rotate into the reading frame.
    const angle = ref.angle ?? 0;
    const a = angle > Math.PI / 2 ? angle - Math.PI : angle;
    // Normalized x/y have different scales on non-square sheets; work in height units.
    const dx = (l.x - ref.x) * aspect, dy = l.y - ref.y;
    const c = Math.cos(a), sn = Math.sin(a);
    return { along: (dx * c - dy * sn) / aspect, down: dx * sn + dy * c };
  };
  const sameAngle = (a: PdfLabel, b: PdfLabel) => {
    const d = Math.abs((a.angle ?? 0) - (b.angle ?? 0)) % Math.PI;
    return Math.min(d, Math.PI - d) < 0.15;
  };
  /** Lines stacked directly above `below` (nearest first), for multi-line names. */
  const CODE = /^[A-Z]{1,4}\d*\.?$/; // STM, PB, FDC, WS7: annotations, not name lines
  const lineAbove = (below: PdfLabel, h: number, used: Set<PdfLabel>, continuation = false) => {
    let best: { label: PdfLabel; d: number } | null = null;
    for (const name of names) {
      if (used.has(name) || !sameAngle(name, below)) continue;
      if (continuation && CODE.test(name.name.trim())) continue;
      const o = local(below, name);
      const dy = -o.down;
      const dx = Math.abs(o.along);
      if (dy <= h * 0.5 || dy > h * (continuation ? 2.8 : 4)) continue;
      if (continuation && dx > h * 3.5) continue;
      const halfWidth = Math.max(textHeight(name) * name.name.length * 0.4, textHeight(below) * below.name.length * 0.4, h * 3);
      if (dx > halfWidth) continue;
      const d = dy + dx * 0.5;
      if (!best || d < best.d) best = { label: name, d };
    }
    return best?.label ?? null;
  };
  const paired: Array<{ tag: PdfLabel; lines: PdfLabel[]; score: number; typeBelow?: PdfLabel }> = [];
  for (const tag of candidates) {
    const h = textHeight(tag);
    const used = new Set<PdfLabel>();
    const first = lineAbove(tag, h, used);
    if (!first) continue;
    const lines = [first]; used.add(first);
    for (let i = 0; i < 2; i++) {
      const next = lineAbove(lines[lines.length - 1]!, h, used, true);
      if (!next) break;
      lines.push(next); used.add(next);
    }
    const o = local(tag, first);
    paired.push({ tag, lines, score: -o.down + Math.abs(o.along) * 0.5 });
  }
  // Unit/suite tags often sit ABOVE their description instead (N221 / MICRO /
  // 28.5 m² / 307 SF). Pair those with the type line directly below.
  const UNIT_TYPE = /^(?:micro|nano|studio|\d+\s*(?:bd|bed(?:room)?s?|br)\b.*|junior.*|bachelor|1\s*\+\s*den.*)(?:\s*\([^)]*\))?$/i;
  for (const tag of candidates) {
    if (paired.some((p) => p.tag === tag)) continue;
    const h = textHeight(tag);
    let below: PdfLabel | null = null;
    for (const l of labels) {
      if (!sameAngle(l, tag)) continue;
      const o = local(tag, l);
      const dy = o.down;
      if (dy <= h * 0.5 || dy > h * 3.2 || Math.abs(o.along) > h * 4) continue;
      if (!UNIT_TYPE.test(l.name.trim())) continue;
      if (!below || dy < local(tag, below).down) below = l;
    }
    if (below) paired.push({ tag, lines: [], typeBelow: below, score: local(tag, below).down });
  }
  // Keep the tag formats the sheet actually uses for its rooms (A-118, B-S105…),
  // not stray numbers that happen to sit under text (dimensions, stall numbers).
  const family = (t: string) => t.replace(/[a-z]$/, "").replace(/S(?=\d)/, "").replace(/\d/g, "9").replace(/[A-Z]/g, "L");
  const counts = new Map<string, number>();
  for (const p of paired) counts.set(family(p.tag.name.trim()), (counts.get(family(p.tag.name.trim())) ?? 0) + 1);
  const top = Math.max(0, ...counts.values());
  const keep = new Set([...counts].filter(([, n]) => n >= Math.max(3, top * 0.25)).map(([f]) => f));
  const seeds: RoomTagSeed[] = [];
  // A room number is unique on a sheet. Door tags repeat it; keep the copy
  // with its name tightest above (the room tag), drop the rest.
  paired.sort((a, b) => a.score - b.score);
  for (const { tag, lines, typeBelow } of paired) {
    const tagText = tag.name.trim();
    if (!keep.has(family(tagText))) continue;
    if (seeds.some((s) => s.tag === tagText)) continue;
    if (typeBelow) {
      const type = typeBelow.name.replace(/\s+/g, " ").trim();
      seeds.push({ x: (tag.x + typeBelow.x) / 2, y: (tag.y + typeBelow.y) / 2, name: `${tagText} ${type}`, tag: tagText, title: type, kind: "tagged" });
      continue;
    }
    const title = [...lines].reverse().map((l) => l.name.replace(/\s+/g, " ").trim()).join(" ");
    const top = lines[lines.length - 1]!;
    seeds.push({
      x: (lines[0]!.x + tag.x) / 2,
      y: (top.y + tag.y) / 2,
      name: `${title} ${tagText}`,
      tag: tagText,
      title,
      kind: "tagged",
    });
  }
  return seeds;
}

/**
 * Combines tag seeds with plain room-name seeds. A name that is part of a
 * tagged room (same title, close by) is dropped so one room is not seeded twice.
 */
export function mergeRoomSeeds<T extends { x: number; y: number; name: string }>(
  tagSeeds: RoomTagSeed[],
  nameSeeds: T[],
  radius = 0.012,
): Array<RoomTagSeed | T> {
  const out: Array<RoomTagSeed | T> = [...tagSeeds];
  for (const seed of nameSeeds) {
    const covered = tagSeeds.some(
      (t) => Math.hypot(t.x - seed.x, t.y - seed.y) < radius &&
        (t.title.toLowerCase().includes(seed.name.toLowerCase()) || seed.name.toLowerCase().includes(t.title.toLowerCase())),
    );
    if (!covered) out.push(seed);
  }
  return out;
}
