import type { PdfLabel } from "../pdf-walls";
import { doorGraph, doorLinks, planRole, type LayeredSegment } from "./door-graph";

/** Room names that are always shared space, whatever their door count. */
const COMMON_NAME = /\b(?:corridor|corr\.?|lobby|vest(?:ibule|\.)?|stairs?|elev(?:ator)?\.?|egress|exit|hallway|mail(?:room)?|garbage|recycl\w*|janitor|jan\.?|elec(?:trical)?\.?|mech(?:anical)?\.?|telecom|tel\.?|riser|amenity|lounge|laundry|fitness|bike|parking|loading)\b/i;
/** The shared space itself, as opposed to a service room off it. */
const CIRCULATION = /\b(?:corridor|corr\.?|lobby|vest(?:ibule|\.)?|hallway)\b/i;
/** Doors needed before a space counts as common without a name. */
const COMMON_DOORS = 6;
/** Doors that make a space common on their own (no unit hallway has this many). */
const MANY_DOORS = 10;
/** Areas in door-size squares (a door is ~0.9 m): anything smaller is a closet. */
const CLOSET_AREA = 4;
/** A doorless space smaller than this is a shaft or chase, not a room. */
const SHAFT_AREA = 8;
/** Suite-tagged units that mark a residential floor. */
const TAGGED_FLOOR = 3;

export type DoorSeed = { x: number; y: number; name: string };

/** Fixture/equipment codes from other trades (DW-38, PD-80, FD-2), not room names. */
const CODE = /^(?:[A-Z]{1,3}-\d+[A-Z]?|[A-Z]{2,4}|\d+)$/;
const UNIT_TAG = /^[A-Z]{0,2}\d{3,4}[A-Z]?$/;
// With an optional qualifier: "MICRO (BF)" is a barrier-free micro suite.
const UNIT_TYPE = /^(?:micro|nano|studio|bachelor|junior\b.*|\d\s*(?:bd|br|bed(?:room)?s?)\b.*|\d\s*\+\s*den.*)(?:\s*\([^)]*\))?$/i;

/** Drops trade codes from a seed name; null when nothing readable is left. */
export function cleanRoomName(name: string) {
  const words = name.replace(/\s+/g, " ").trim().split(" ");
  while (words.length && CODE.test(words[words.length - 1]!) && !UNIT_TAG.test(words[words.length - 1]!)) words.pop();
  while (words.length && CODE.test(words[0]!) && !UNIT_TAG.test(words[0]!)) words.shift();
  const out = words.join(" ").replace(/[\s/]+$/, "");
  return /[A-Za-z]{3}/.test(out) || UNIT_TAG.test(words[0] ?? "") ? out : null;
}

/**
 * Suite tags as printed in units: "N119" with its type ("NANO", "1 BED")
 * just above or below. Each becomes one seed between the two lines.
 */
export function unitTagSeeds(labels: PdfLabel[], aspect: number): DoorSeed[] {
  const types = labels.filter((l) => UNIT_TYPE.test(l.name.trim()));
  const seeds: DoorSeed[] = [];
  for (const tag of labels) {
    if (!UNIT_TAG.test(tag.name.trim())) continue;
    let best: PdfLabel | null = null, bestD = Infinity;
    for (const type of types) {
      const dx = (type.x - tag.x) * aspect, dy = type.y - tag.y;
      const d = Math.hypot(dx * 2, dy);
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.012 || d >= bestD) continue;
      best = type; bestD = d;
    }
    if (best) seeds.push({ x: (tag.x + best.x) / 2, y: (tag.y + best.y) / 2, name: `${tag.name.trim()} ${best.name.trim().toUpperCase()}` });
  }
  return seeds;
}

export type DoorSpaceClass = {
  /** Space labels that are common (corridors, lobbies, stairs…). */
  common: number[];
  /** Each unit's space labels; one unit per apartment/suite. */
  units: number[][];
};

/**
 * Splits a door graph into common spaces and units. Common spaces are the
 * spaces many doors open into, plus spaces the drawing names as shared.
 * Everything left is grouped by the doors between spaces: a unit is the set
 * of spaces reached through one door off a common space.
 *
 * A unit's own hallway can also have several doors (bedrooms, bath,
 * closets). Two things separate a real corridor: it serves at least three
 * rooms bigger than a closet, and (unless it has a great many doors) it
 * links other common spaces — corridors need two ways out (stairs, lobby),
 * while a unit's hallway only opens onto the corridor it hangs off.
 */
export function classifyDoorSpaces(input: {
  spaces: number[];
  area: (id: number) => number;
  doorSize: number;
  /** Each door's two spaces; 0 is the outside. */
  doors: number[][];
  names: Map<number, string[]>;
}): DoorSpaceClass {
  const { spaces, doors, names } = input;
  const closet = CLOSET_AREA * input.doorSize ** 2;
  const neighbours = new Map<number, Set<number>>(spaces.map((s) => [s, new Set()]));
  const degree = new Map<number, number>();
  for (const door of doors) {
    for (const s of new Set(door)) if (s) degree.set(s, (degree.get(s) ?? 0) + 1);
    if (door.length === 2 && door[0] && door[1] && door[0] !== door[1]) {
      neighbours.get(door[0]!)?.add(door[1]!);
      neighbours.get(door[1]!)?.add(door[0]!);
    }
  }
  const named = new Set(spaces.filter((s) => names.get(s)?.some((n) => COMMON_NAME.test(n))));
  const common = new Set(spaces.filter((s) => named.has(s) || (degree.get(s) ?? 0) >= COMMON_DOORS));

  const groups = () => {
    const group = new Map<number, number>();
    const members: number[][] = [];
    for (const start of spaces) {
      if (common.has(start) || group.has(start)) continue;
      const id = members.length;
      const list = [start];
      group.set(start, id);
      for (let i = 0; i < list.length; i++)
        for (const n of neighbours.get(list[i]!)!)
          if (!common.has(n) && !group.has(n)) { group.set(n, id); list.push(n); }
      members.push(list);
    }
    return { group, members };
  };

  // Drop the least convincing door-heavy space until every remaining one
  // looks like a corridor or lobby.
  for (;;) {
    const { group, members } = groups();
    const size = members.map((m) => m.reduce((sum, s) => sum + input.area(s), 0));
    let worst: { space: number; score: number } | null = null;
    for (const c of common) {
      if (named.has(c)) continue;
      const behind = new Set<number>();
      let linked = 0;
      for (const n of neighbours.get(c)!) {
        if (common.has(n)) linked++;
        else if (group.has(n)) behind.add(group.get(n)!);
      }
      const served = [...behind].filter((g) => size[g]! >= closet).length;
      const doorsIn = degree.get(c) ?? 0;
      const ok = served >= 3 && (doorsIn >= MANY_DOORS || linked >= 2);
      const score = doorsIn + linked;
      if (!ok && (!worst || score < worst.score)) worst = { space: c, score };
    }
    if (!worst) return { common: [...common], units: members };
    common.delete(worst.space);
  }
}

export function layeredPlanStats(segments: LayeredSegment[]) {
  let walls = 0, doors = 0;
  for (const s of segments) {
    const role = planRole(s.layer);
    if (role === "wall") walls++;
    else if (role === "door") doors++;
  }
  return { walls, doors };
}

/** Enough wall and door linework on named layers to read the plan by its doors. */
export function hasDoorLayers(segments: LayeredSegment[]) {
  const { walls, doors } = layeredPlanStats(segments);
  return walls >= 200 && doors >= 40;
}

export type DoorRoom = {
  kind: "common" | "unit";
  name?: string;
  spaces: number[];
};

/**
 * Full pipeline on layered linework: door graph → common spaces and units →
 * one label per room (walls between a unit's own spaces are absorbed so each
 * unit is one region). Label image values are 1-based indices into `rooms`.
 */
export function detectDoorRooms(
  segments: LayeredSegment[],
  { width, height, seeds = [] }: { width: number; height: number; seeds?: DoorSeed[] },
) {
  const graph = doorGraph(segments, { width, height });
  const { label, area, edge, doorSize } = graph;
  const minArea = (doorSize * 0.8) ** 2;
  const isSpace = (id: number) => id > 0 && !edge[id] && area[id]! >= minArea;
  const links = doorLinks(graph, width, height, minArea);
  const spaces: number[] = [];
  for (let id = 1; id <= graph.count; id++) if (isSpace(id)) spaces.push(id);
  /** Text often sits on a fixture or swing line; take the nearest space. */
  const spaceNear = (cx: number, cy: number) => {
    const limit = Math.round(doorSize * 0.4);
    for (let r = 0; r <= limit; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = Math.round(cx) + dx, y = Math.round(cy) + dy;
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          const id = label[y * width + x]!;
          if (isSpace(id)) return id;
        }
    return 0;
  };
  // Seeds come in priority order; a room takes the best name among its spaces.
  const names = new Map<number, string[]>();
  const rank = new Map<string, number>();
  seeds.forEach((seed, i) => {
    const name = cleanRoomName(seed.name);
    if (!name) return;
    const id = spaceNear(seed.x * (width - 1), seed.y * (height - 1));
    if (!id) return;
    names.set(id, [...(names.get(id) ?? []), name]);
    if (!rank.has(name)) rank.set(name, i);
  });
  // A door links two spaces, or a space and the outside (0). Fragments of
  // door blocks (tag bubbles, frame ticks) that link nothing are not doors.
  const doors = links
    .filter((d) => Math.max(d.right - d.left, d.bottom - d.top) >= doorSize * 0.5)
    .map((d) => [...d.spaces.filter(isSpace), ...(d.outside ? [0] : [])])
    .filter((d) => d.length === 2);
  const classes = classifyDoorSpaces({ spaces, area: (id) => area[id]!, doorSize, doors, names });

  const rooms: DoorRoom[] = [];
  // Best name first; a corridor prefers a shared-space name over a suite tag
  // that spilled across its door, and a unit the reverse. Then the name in
  // the biggest space: a room with a closet off it is named for the room.
  const nameOf = (members: number[], prefer: (name: string) => boolean) =>
    members
      .flatMap((s) => (names.get(s) ?? []).map((name) => ({ name, size: area[s]! })))
      .sort((a, b) => Number(prefer(b.name)) - Number(prefer(a.name)) || b.size - a.size || Number(COMMON_NAME.test(b.name)) - Number(COMMON_NAME.test(a.name)) || rank.get(a.name)! - rank.get(b.name)!)[0]?.name;
  for (const c of classes.common) rooms.push({ kind: "common", name: nameOf([c], (n) => CIRCULATION.test(n)), spaces: [c] });
  const shaft = SHAFT_AREA * doorSize ** 2;
  const isTag = (n: string) => UNIT_TAG.test(n.split(" ")[0]!);
  const units = classes.units.map((unit) => ({
    spaces: unit,
    name: nameOf(unit, isTag),
    total: unit.reduce((sum, s) => sum + area[s]!, 0),
    hasDoor: doors.some((d) => d.some((s) => s && unit.includes(s))),
  }));
  // On a floor of tagged suites every room is common space or a suite, so a
  // doorless space with no name is outdoors: a balcony, terrace or the gap
  // between buildings. Elsewhere (parkades, service floors) doors are often
  // missed and the space is kept.
  const suites = units.filter((u) => u.name && isTag(u.name)).length >= TAGGED_FLOOR;
  for (const unit of units) {
    // Shafts and chases: small, no door. Not rooms.
    if (!unit.hasDoor && (unit.total < shaft || (suites && !unit.name))) continue;
    rooms.push({ kind: "unit", name: unit.name, spaces: unit.spaces });
  }

  const roomOf = new Int32Array(graph.count + 1);
  rooms.forEach((room, i) => { for (const s of room.spaces) roomOf[s] = i + 1; });
  const labels = new Int32Array(width * height);
  for (let p = 0; p < labels.length; p++) labels[p] = roomOf[label[p]!]!;
  absorbWalls(labels, label, edge, width, height, Math.max(2, Math.round(doorSize * 0.3)));
  return {
    rooms,
    labels,
    doorSize,
    doors: links.length,
    /** Doors that join two indoor spaces. */
    links: doors.filter((d) => d[0] && d[1]).length,
    sealed: graph.sealed,
    spaces: spaces.length,
  };
}

/**
 * Grows rooms into wall pixels (up to `reach`), then fills any leftover
 * pocket enclosed by a single room (door swings, columns, interior walls).
 * Never grows into the outside.
 */
function absorbWalls(labels: Int32Array, space: Int32Array, edge: boolean[], width: number, height: number, reach: number) {
  const N = labels.length;
  const blocked = (p: number) => edge[space[p]!] === true;
  let frontier: number[] = [];
  for (let p = 0; p < N; p++) if (labels[p]) frontier.push(p);
  for (let step = 0; step < reach && frontier.length; step++) {
    const next: number[] = [];
    for (const p of frontier) {
      const x = p % width, v = labels[p]!;
      for (const n of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
        if (n < 0 || n >= N || labels[n] || blocked(n)) continue;
        labels[n] = v;
        next.push(n);
      }
    }
    frontier = next;
  }
  // Pockets: unassigned regions bordered by exactly one room.
  const seen = new Uint8Array(N);
  const queue = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (labels[s] || seen[s]) continue;
    let head = 0, tail = 0, owner = 0, mixed = false;
    queue[tail++] = s;
    seen[s] = 1;
    while (head < tail) {
      const p = queue[head++]!;
      const x = p % width;
      if (x === 0 || x === width - 1 || p < width || p >= N - width || blocked(p)) mixed = true;
      for (const n of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
        if (n < 0 || n >= N) continue;
        const v = labels[n]!;
        if (v) { if (owner && owner !== v) mixed = true; owner = v; continue; }
        if (!seen[n]) { seen[n] = 1; queue[tail++] = n; }
      }
    }
    if (mixed || !owner) continue;
    for (let i = 0; i < tail; i++) labels[queue[i]!] = owner;
  }
}
