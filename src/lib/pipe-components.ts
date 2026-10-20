import {
  coreGroup,
  fittingGroups,
  closedFittingOutline,
  fittingConnection,
} from "./pipe-fitting-geometry";
import { pipeFittingProfile, resolvePipeFitting } from "./pipe-fitting-profile";
import { dashedRunAt } from "./pipe-dashed-junction";
import { strokeJunctionAt } from "./pipe-stroke-junction";
import { recoverPipeSymbols } from "./pipe-symbol-recovery";
import {
  customComponentMarker,
  vectorComponentMarker,
} from "./pipe-component-marker";
import type { LegendItemData } from "./drawing-legend";
import {
  layerSystem,
  type PipeLinework,
  type PipeSegment,
  type PipeSystemSelection,
} from "./pipe-system";
import type { SheetPoint } from "./sheet-measure";
import {
  type PipeComponentBox as Box,
  type PipeComponentCandidate as Candidate,
  type PipeComponentKind as Kind,
  type PipeComponentsResult,
  type PipeDrawingText,
  type PipeSymbolPath,
  type PipeSymbolTemplate,
} from "./pipe-components-types";

const LIMIT = 1000;
const CELL = 0.02;
const center = (b: Box) => ({
  x: (b.left + b.right) / 2,
  y: (b.top + b.bottom) / 2,
});
const bounds = (points: SheetPoint[]): Box => {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const p of points) {
    left = Math.min(left, p.x);
    top = Math.min(top, p.y);
    right = Math.max(right, p.x);
    bottom = Math.max(bottom, p.y);
  }
  return { left, top, right, bottom };
};
function validPoint(p: SheetPoint) {
  return (
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    p.x >= 0 &&
    p.x <= 1 &&
    p.y >= 0 &&
    p.y <= 1
  );
}
function validBox(b: Box) {
  return (
    validPoint({ x: b.left, y: b.top }) &&
    validPoint({ x: b.right, y: b.bottom }) &&
    b.left <= b.right &&
    b.top <= b.bottom
  );
}
function inside(a: Box, b: Box) {
  return (
    a.left >= b.left &&
    a.right <= b.right &&
    a.top >= b.top &&
    a.bottom <= b.bottom
  );
}
function overlap(a: Box, b: Box, pad = 0) {
  return (
    a.left <= b.right + pad &&
    a.right >= b.left - pad &&
    a.top <= b.bottom + pad &&
    a.bottom >= b.top - pad
  );
}
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}
function distance(p: SheetPoint, s: PipeSegment, aspect: number) {
  const dx = s.x2 - s.x1,
    dy = (s.y2 - s.y1) * aspect,
    px = p.x - s.x1,
    py = (p.y - s.y1) * aspect;
  const t = Math.max(
    0,
    Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(px - t * dx, py - t * dy);
}
function segmentGrid(
  segments: PipeSegment[],
  aspect: number,
  limited: () => void,
) {
  let checks = 0;
  const grid = new Map<string, number[]>();
  segments.forEach((s, i) => {
    const needed = Math.max(
      1,
      Math.ceil(Math.hypot(s.x2 - s.x1, (s.y2 - s.y1) * aspect) / CELL),
    );
    const n = Math.min(needed, 256);
    if (needed > n) limited();
    for (let j = 0; j <= n; j++) {
      const key = `${Math.floor((s.x1 + ((s.x2 - s.x1) * j) / n) / CELL)},${Math.floor(((s.y1 + ((s.y2 - s.y1) * j) / n) * aspect) / CELL)}`;
      const values = grid.get(key) ?? [];
      if (values.length < 2048 && values.at(-1) !== i) values.push(i);
      else if (values.length >= 2048) limited();
      grid.set(key, values);
    }
  });
  return (p: SheetPoint, reach = 0.015) => {
    if (checks >= 2000000) {
      limited();
      return [];
    }
    const found = new Set<number>(),
      cx = Math.floor(p.x / CELL),
      cy = Math.floor((p.y * aspect) / CELL),
      r = Math.ceil(reach / CELL) + 1;
    for (let x = cx - r; x <= cx + r; x++)
      for (let y = cy - r; y <= cy + r; y++)
        for (const i of grid.get(`${x},${y}`) ?? []) found.add(i);
    checks += found.size;
    return [...found]
      .map((i) => ({
        segment: segments[i]!,
        distance: distance(p, segments[i]!, aspect),
      }))
      .filter((v) => v.distance <= reach)
      .sort((a, b) => a.distance - b.distance);
  };
}
export function componentDescription(text: string): {
  kind: Kind;
  name: string;
  size?: string;
  material?: string;
  tag?: string;
} | null {
  const t = text
    .trim()
    .replace(/[_|]/g, " ")
    .replace(/(?<=[a-z])-(?=[a-z])/gi, " ")
    .replace(/\s+/g, " ");
  if (
    t.length > 160 ||
    /\b(?:PROVIDE|SHALL|GENERAL NOTES|ALL VALVES|ALL FITTINGS)\b/i.test(t)
  )
    return null;
  let kind: Kind | undefined,
    name = "";
  const valve =
    /\b(?:(PRESSURE[- ]REDUCING|BALL|GATE|CHECK|BALANCING|BUTTERFLY|GLOBE|ISOLATION|CONTROL|RELIEF|DRAIN|MIXING)\s+)?VALV(?:E|ES)?\b/i.exec(
      t,
    );
  const fitting = pipeFittingProfile(t);
  if (fitting) {
    kind = fitting.kind;
    name = fitting.name;
  } else if (valve) {
    kind = "valve";
    name = valve[1] ? `${valve[1].toLowerCase()} valve` : "Valve";
  } else if (/\bELBOW\b|\bBEND\b/i.test(t)) {
    kind = "elbow";
    const angle =
      /\b(22(?:\.5)?|45|90)\s*(?:°|DEG(?:REE)?S?)|\b(22(?:\.5)?|45|90)(?=\s+(?:ELBOW|BEND)\b)|\b(?:ELBOW|BEND)\s+(22(?:\.5)?|45|90)\b/i.exec(
        t,
      );
    name = angle ? `${angle[1] ?? angle[2] ?? angle[3]}° elbow` : "Elbow";
  } else if (/\bTEE\b|\bWYE\b/i.test(t)) {
    kind = "tee";
    name = /\bWYE\b/i.test(t) ? "Wye" : "Tee";
  } else if (/\bREDUCER\b/i.test(t)) {
    kind = "reducer";
    name = "Reducer";
  } else if (/\bCOUPLING\b/i.test(t)) {
    kind = "coupling";
    name = "Coupling";
  } else if (/\b(?:PIPE|PIPING)\s+(?:UP|RISE)\b|\bRISER\s+UP\b/i.test(t)) {
    kind = "rise";
    name = "Pipe up";
  } else if (
    /\b(?:PIPE|PIPING)\s+(?:DOWN|DN|DROP)\b|\bRISER\s+(?:DOWN|DN)\b/i.test(t)
  ) {
    kind = "drop";
    name = "Pipe down";
  } else if (/\bCAP\b/i.test(t)) {
    kind = "cap";
    name = "Cap";
  }
  const tag = /\b(?:V|BV|GV|CV|PRV|BFP)[- ]?\d{1,5}[A-Z]?\b/i.exec(t)?.[0];
  if (!kind && tag) {
    kind = "valve";
    name = "Valve";
  } // A tag alone never establishes the valve subtype.
  if (!kind) return null;
  name = name.charAt(0).toUpperCase() + name.slice(1);
  const size =
    /\bDN\s*\d+(?:\s*[x×]\s*\d+)?\b|\b\d+(?:[ .-]\d+\/\d+|\/\d+|\.\d+)?\s*(?:["″]|(?:mm|in(?:ch(?:es)?)?)\b)/i.exec(
      t,
    )?.[0];
  const material =
    /\b(?:STAINLESS(?: STEEL)?|CAST IRON|DUCTILE IRON|COPPER|CPVC|PVC|ABS|CARBON STEEL|STEEL|BRASS)\b/i.exec(
      t,
    )?.[0];
  return {
    kind,
    name,
    ...(size ? { size } : {}),
    ...(material ? { material } : {}),
    ...(tag ? { tag } : {}),
  };
}

type Group = {
  id: string;
  paths: PipeSymbolPath[];
  box: Box;
  point: SheetPoint;
  layer?: string;
  fittingOnly?: boolean;
};
function symbolGroups(
  paths: PipeSymbolPath[],
  aspect: number,
  limited: () => void,
): Group[] {
  // Union only overlapping/touching symbol paths. Long pipe strokes are never symbols.
  const usable = paths
    .slice(0, 15000)
    .filter(
      (p) =>
        p.points.length >= 2 &&
        p.points.length <= 512 &&
        p.points.every(validPoint),
    );
  const parent = usable.map((_, i) => i),
    boxes = usable.map((p) => bounds(p.points));
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const cells = new Map<string, number[]>();
  let work = 0;
  usable.forEach((p, i) => {
    const b = boxes[i]!,
      pad = 0.00012;
    if (Math.max(b.right - b.left, (b.bottom - b.top) * aspect) > 0.06) return;
    const seen = new Set<number>();
    for (
      let x = Math.floor((b.left - pad) / CELL);
      x <= Math.floor((b.right + pad) / CELL);
      x++
    )
      for (
        let y = Math.floor((b.top * aspect - pad) / CELL);
        y <= Math.floor((b.bottom * aspect + pad) / CELL);
        y++
      ) {
        const key = `${x},${y}`,
          ids = cells.get(key) ?? [];
        for (const j of ids) {
          if (seen.has(j)) continue;
          if (++work > 500000) {
            limited();
            break;
          }
          seen.add(j);
          if (
            p.layer !== usable[j]!.layer ||
            !overlap(b, boxes[j]!, pad / Math.min(1, aspect))
          )
            continue;
          const q = usable[j]!,
            qb = boxes[j]!;
          const length = (box: Box) =>
            Math.hypot(box.right - box.left, (box.bottom - box.top) * aspect);
          if (
            (!p.closed &&
              p.points.length === 2 &&
              q.closed &&
              length(b) > length(qb) * 2) ||
            (!q.closed &&
              q.points.length === 2 &&
              p.closed &&
              length(qb) > length(b) * 2)
          )
            continue;
          const joinPad = Math.min(
            pad,
            Math.min(length(b), length(qb)) * 0.025,
          );
          if (!overlap(b, qb, joinPad / Math.max(1, aspect))) continue;
          const a = find(i),
            other = find(j);
          if (a !== other) parent[a] = other;
        }
        if (ids.length < 256) ids.push(i);
        cells.set(key, ids);
      }
  });
  const groups = new Map<number, PipeSymbolPath[]>();
  usable.forEach((p, i) => {
    const id = find(i),
      list = groups.get(id) ?? [];
    if (list.length < 100) list.push(p);
    else limited();
    groups.set(id, list);
  });
  return [...groups.values()].flatMap((paths) => {
    const points = paths.flatMap((p) => p.points),
      box = bounds(points),
      w = box.right - box.left,
      h = (box.bottom - box.top) * aspect;
    if (Math.max(w, h) > 0.06 || Math.min(w, h) < 0.0001) return [];
    return [
      {
        id: hash(
          paths
            .map((p) => p.id)
            .sort()
            .join("|"),
        ),
        paths,
        box,
        point: center(box),
        layer: paths[0]?.layer,
      },
    ];
  });
}
function shape(group: Group, aspect: number, rotation = 0): [number, number][] {
  const b = group.box,
    w = b.right - b.left,
    h = (b.bottom - b.top) * aspect,
    scale = Math.max(w, h),
    set = new Set<string>();
  for (const path of group.paths)
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1]!,
        p = path.points[i]!,
        steps = Math.max(
          1,
          Math.min(
            24,
            Math.ceil(
              (Math.hypot(p.x - a.x, (p.y - a.y) * aspect) / scale) * 24,
            ),
          ),
        );
      for (let n = 0; n <= steps; n++) {
        let x = (a.x + ((p.x - a.x) * n) / steps - group.point.x) / scale,
          y =
            ((a.y + ((p.y - a.y) * n) / steps - group.point.y) * aspect) /
            scale;
        for (let k = 0; k < rotation; k++) [x, y] = [-y, x];
        set.add(`${Math.round(x * 24)},${Math.round(y * 24)}`);
      }
    }
  return [...set]
    .slice(0, 256)
    .map((s) => s.split(",").map(Number) as [number, number]);
}
function alignedShape(
  points: [number, number][],
  rotation = 0,
): [number, number][] {
  if (!points.length) return [];
  const mx = points.reduce((n, p) => n + p[0], 0) / points.length,
    my = points.reduce((n, p) => n + p[1], 0) / points.length;
  let xx = 0,
    yy = 0,
    xy = 0;
  for (const [x, y] of points) {
    xx += (x - mx) ** 2;
    yy += (y - my) ** 2;
    xy += (x - mx) * (y - my);
  }
  const anisotropy = Math.hypot(xx - yy, 2 * xy) / (xx + yy || 1);
  const farthest = points.reduce((a, b) =>
    (b[0] - mx) ** 2 + (b[1] - my) ** 2 > (a[0] - mx) ** 2 + (a[1] - my) ** 2
      ? b
      : a,
  );
  const axis =
    anisotropy < 0.08
      ? Math.atan2(farthest[1] - my, farthest[0] - mx)
      : 0.5 * Math.atan2(2 * xy, xx - yy);
  const angle = -axis + (rotation * Math.PI) / 2;
  const rotated = points.map(([x, y]) => [
    (x - mx) * Math.cos(angle) - (y - my) * Math.sin(angle),
    (x - mx) * Math.sin(angle) + (y - my) * Math.cos(angle),
  ]);
  const xs = rotated.map((p) => p[0]!),
    ys = rotated.map((p) => p[1]!);
  const left = Math.min(...xs),
    right = Math.max(...xs),
    top = Math.min(...ys),
    bottom = Math.max(...ys),
    scale = Math.max(right - left, bottom - top) || 1;
  return [
    ...new Set(
      rotated.map(
        ([x, y]) =>
          `${Math.round(((x! - (left + right) / 2) / scale) * 24)},${Math.round(((y! - (top + bottom) / 2) / scale) * 24)}`,
      ),
    ),
  ].map((p) => p.split(",").map(Number) as [number, number]);
}
function sameShape(a: [number, number][], b: [number, number][]) {
  if (
    !a.length ||
    !b.length ||
    Math.max(a.length, b.length) / Math.min(a.length, b.length) > 1.6
  )
    return false;
  const close = (from: [number, number][], to: [number, number][]) => {
    const cells = new Set(to.map(([x, y]) => x * 100 + y));
    let matched = 0;
    for (const [x, y] of from) {
      let found = false;
      for (let dx = -1; dx <= 1 && !found; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          if (cells.has((x + dx) * 100 + y + dy)) {
            found = true;
            break;
          }
        }
      if (found) matched++;
    }
    return matched / from.length;
  };
  return close(a, b) >= 0.9 && close(b, a) >= 0.9;
}
function mergedTexts(texts: PipeDrawingText[]): PipeDrawingText[] {
  const valid = texts
    .slice(0, 30000)
    .filter((t) => validBox(t) && typeof t.text === "string" && t.text.trim());
  // Keep originals as well as short, adjacent text runs: CAD often splits "BALL VALVE".
  const rows = new Map<number, PipeDrawingText[]>();
  for (const t of valid) {
    const key = Math.round((t.top + t.bottom) / 2 / 0.003),
      row = rows.get(key) ?? [];
    row.push(t);
    rows.set(key, row);
  }
  const joined: PipeDrawingText[] = [];
  for (const row of rows.values()) {
    row.sort((a, b) => a.left - b.left);
    for (let i = 0; i < row.length; i++) {
      const a = row[i]!;
      let text = a.text,
        b = { ...a };
      for (let j = i + 1; j < Math.min(row.length, i + 5); j++) {
        const next = row[j]!,
          height = Math.max(a.bottom - a.top, 0.0005);
        if (
          next.left - b.right > height * 1.8 ||
          next.left < b.right - height * 0.2 ||
          Math.abs((next.top + next.bottom - a.top - a.bottom) / 2) >
            height * 0.4
        )
          break;
        text += ` ${next.text}`;
        b = {
          ...b,
          right: next.right,
          top: Math.min(b.top, next.top),
          bottom: Math.max(b.bottom, next.bottom),
        };
        if (text.length <= 160) joined.push({ ...b, text });
      }
    }
  }
  return [...joined, ...valid];
}
function sourceSystem(layer?: string) {
  return (
    layerSystem(layer) ??
    layerSystem(
      layer?.replace(
        /[-_ ](?:VALV(?:E|ES)?|FITT(?:ING|INGS)?|ELBOW|TEE|REDUCER|COUPLING|CAP)(?:[-_ ].*)?$/i,
        "",
      ),
    )
  );
}
function crossing(path: PipeSymbolPath, aspect: number) {
  if (!path.closed || path.points.length < 5 || path.points.length > 12)
    return false;
  for (let i = 1; i < path.points.length; i++)
    for (let j = i + 2; j < path.points.length; j++) {
      const a = path.points[i - 1]!,
        b = path.points[i]!,
        c = path.points[j - 1]!,
        d = path.points[j]!;
      const dx = b.x - a.x,
        dy = (b.y - a.y) * aspect,
        ex = d.x - c.x,
        ey = (d.y - c.y) * aspect,
        den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const px = c.x - a.x,
        py = (c.y - a.y) * aspect,
        t = (px * ey - py * ex) / den,
        u = (px * dy - py * dx) / den;
      if (t > 0.05 && t < 0.95 && u > 0.05 && u < 0.95) return true;
    }
  return false;
}

/** Keep separate existing/new variants in a legend cell as separate references. */
export function savedLegendTemplates(
  item: {
    id: string;
    revision: number;
    data: LegendItemData;
  },
  source: { id: string; name: string },
  linework: PipeLinework,
): PipeSymbolTemplate[] {
  const paths = (linework.symbols ?? []).filter(
    (p) =>
      p.points.length >= 2 &&
      p.points.every(validPoint) &&
      inside(bounds(p.points), item.data.symbol),
  );
  // Preserve disconnected strokes of one symbol. Split only the widely
  // separated existing/new variants, not every disconnected hatch or stem.
  const pieces = symbolGroups(paths, linework.aspect, () => undefined).sort(
    (a, b) => a.box.left - b.box.left,
  );
  const groups: Group[] = [];
  const gap = Math.max(
    0.001,
    (item.data.symbol.bottom - item.data.symbol.top) * linework.aspect * 0.4,
  );
  for (const piece of pieces) {
    const previous = groups.at(-1);
    if (previous && piece.box.left - previous.box.right < gap) {
      previous.paths.push(...piece.paths);
      previous.box = bounds(previous.paths.flatMap((p) => p.points));
      previous.point = center(previous.box);
    } else groups.push({ ...piece, paths: [...piece.paths] });
  }
  return groups.slice(0, 8).map((group, i) => ({
    id: `legend:${item.id}:${item.revision}:${i}`,
    kind: componentDescription(item.data.name)?.kind ?? "other",
    name: item.data.name.slice(0, 120),
    box: group.box,
    reference: {
      paths: group.paths,
      aspect: linework.aspect,
      abbreviation: item.data.abbreviation,
      sheetName: source.name,
      sourceSheetId: source.id,
      legendId: item.id,
      revision: item.revision,
    },
  }));
}
const abbreviationKey = (text: string) =>
  text.trim().toUpperCase().replace(/[.\s]/g, "");

export function analyzePipeComponents(
  linework: PipeLinework,
  selection: PipeSystemSelection,
  templates: PipeSymbolTemplate[] = [],
): PipeComponentsResult {
  const aspect = linework.aspect,
    warnings: string[] = [],
    candidates: Candidate[] = [];
  if (
    !Number.isFinite(aspect) ||
    !(aspect > 0) ||
    aspect > 100 ||
    !selection.segments.length
  )
    return { candidates, warnings, partial: false };
  let partial =
    selection.truncated ||
    linework.truncated ||
    !!linework.componentDataPartial ||
    (linework.symbols?.length ?? 0) > 15000 ||
    (linework.texts?.length ?? 0) > 30000;
  if (!linework.componentDataVersion)
    warnings.push(
      "This cached drawing has no component symbols or text. Reload it while connected to analyze components.",
    );
  const limited = () => {
    partial = true;
  };
  const selectedNear = segmentGrid(selection.segments, aspect, limited);
  const allPipes = linework.segments.filter((s) => !!layerSystem(s.layer));
  const allNear = segmentGrid(allPipes, aspect, limited);
  const belongs = (p: SheetPoint, box?: Box, layer?: string) => {
    const code = sourceSystem(layer);
    if (code && selection.system && code !== selection.system) return false;
    const reach = box
      ? Math.min(
          0.02,
          Math.max(
            0.003,
            Math.hypot(box.right - box.left, (box.bottom - box.top) * aspect) /
              2 +
              0.0015,
          ),
        )
      : 0.003;
    const nearest = selectedNear(p, reach)[0];
    if (!nearest) return false;
    const foreign = allNear(p, reach)[0];
    return (
      !foreign ||
      !selection.system ||
      layerSystem(foreign.segment.layer) === selection.system ||
      foreign.distance > nearest.distance + 0.0001
    );
  };
  const symbolPaths = recoverPipeSymbols(linework, selectedNear, limited);
  const groups = symbolGroups(symbolPaths, aspect, limited);
  const fittingNear = segmentGrid(selection.segments, aspect, limited);
  const texts = mergedTexts(linework.texts ?? []);
  const descriptions = texts.flatMap((t) => {
    const d = componentDescription(t.text);
    return d ? [{ ...d, text: t }] : [];
  });
  const add = (
    kind: Kind,
    name: string,
    point: SheetPoint,
    box: Box,
    source: Candidate["source"],
    evidence: string,
    extra: Partial<Candidate> = {},
  ) => {
    if (candidates.length >= LIMIT) {
      partial = true;
      return;
    }
    if (!validPoint(point) || !validBox(box)) return;
    const fingerprint = hash(
      JSON.stringify([
        kind,
        [box.left, box.top, box.right, box.bottom].map((n) =>
          Math.round(n * 1e7),
        ),
        source,
        evidence,
      ]),
    );
    const candidate: Candidate = {
      id: `pc-${fingerprint}`,
      fingerprint,
      kind,
      name,
      point,
      box,
      source,
      evidence: evidence.slice(0, 500),
      system: selection.system,
      ...extra,
    };
    const previous = candidates.findIndex(
      (c) =>
        c.kind === kind &&
        Math.hypot(c.point.x - point.x, (c.point.y - point.y) * aspect) <
          Math.max(
            1e-7,
            Math.min(
              source === "geometry" && c.source === "geometry"
                ? 0.00002
                : 0.0005,
              Math.max(box.right - box.left, (box.bottom - box.top) * aspect) *
                0.15,
              Math.max(
                c.box.right - c.box.left,
                (c.box.bottom - c.box.top) * aspect,
              ) * 0.15,
            ),
          ),
    );
    const rank = { layer: 4, tag: 3, legend: 2, geometry: 1 };
    const priority = (c: Candidate) =>
      c.source === "legend" && c.evidence.startsWith("Saved legend:")
        ? 5
        : rank[c.source];
    if (previous < 0) candidates.push(candidate);
    else {
      const existing = candidates[previous]!;
      if (priority(candidate) > priority(existing))
        candidates[previous] = {
          ...candidate,
          size: candidate.size ?? existing.size,
          material: candidate.material ?? existing.material,
          tag: candidate.tag ?? existing.tag,
        };
      else if (source === "tag" && existing.source === "layer") {
        existing.size ??= candidate.size;
        existing.material ??= candidate.material;
        existing.tag ??= candidate.tag;
        existing.evidence = `${existing.evidence}; ${candidate.evidence}`.slice(
          0,
          500,
        );
        if (existing.name === "Valve") existing.name = candidate.name;
        existing.fingerprint = hash(
          JSON.stringify([
            existing.id,
            existing.evidence,
            existing.name,
            existing.size,
            existing.material,
          ]),
        );
      }
    }
  };
  // Build named symbol references from explicit legend entries or user-taught regions.
  const refs: {
    group: Group;
    kind: Kind;
    name: string;
    evidence: string;
    size?: string;
    material?: string;
    aspect?: number;
    abbreviation?: string;
    external?: boolean;
    legendId?: string;
  }[] = [];
  for (const template of templates.slice(0, 600)) {
    if (!validBox(template.box)) continue;
    const paths = (template.reference?.paths ?? linework.symbols ?? [])
      .slice(0, 15000)
      .filter(
        (p) =>
          p.points.length >= 2 &&
          p.points.length <= 512 &&
          p.points.every(validPoint) &&
          inside(bounds(p.points), template.box),
      );
    if (!paths.length || paths.length > 100) {
      warnings.push(
        `Symbol reference “${template.name}” contains no usable vector symbol, or is too large. Pick just one symbol.`,
      );
      continue;
    }
    const box = bounds(paths.flatMap((p) => p.points));
    refs.push({
      group: { id: template.id, paths, box, point: center(box) },
      kind: template.kind,
      name: template.name,
      evidence: template.reference
        ? `Saved legend: ${template.name} (${template.reference.sheetName}; reference ${template.reference.legendId}, revision ${template.reference.revision})`
        : `User-taught symbol: ${template.name}`,
      aspect: template.reference?.aspect ?? aspect,
      abbreviation: template.reference?.abbreviation,
      external: !!template.reference,
      legendId: template.reference?.legendId,
    });
  }
  const legendHeads = texts.filter((t) =>
    /\b(?:LEGEND|SYMBOLS)\b/i.test(t.text),
  );
  for (const d of descriptions.slice(0, 300)) {
    const p = center(d.text);
    if (
      !legendHeads.some(
        (h) =>
          Math.abs(center(h).x - p.x) < 0.25 &&
          Math.abs(center(h).y - p.y) * aspect < 0.35,
      )
    )
      continue;
    const nearby = groups
      .filter(
        (g) =>
          Math.abs(g.point.x - p.x) < 0.12 &&
          Math.abs(g.point.y - p.y) * aspect <
            Math.max(0.006, (d.text.bottom - d.text.top) * aspect * 1.5),
      )
      .sort(
        (a, b) =>
          Math.hypot(a.point.x - p.x, (a.point.y - p.y) * aspect) -
          Math.hypot(b.point.x - p.x, (b.point.y - p.y) * aspect),
      );
    const group = nearby.find(
      (g) =>
        g.box.right <= d.text.left + 0.001 ||
        g.box.left >= d.text.right - 0.001,
    );
    if (group)
      refs.push({
        group,
        kind: d.kind,
        name: d.name,
        evidence: `Drawing legend: ${d.text.text}`,
        size: d.size,
        material: d.material,
      });
  }
  if (refs.some((r) => pipeFittingProfile(r.name)))
    groups.push(...fittingGroups(symbolPaths, aspect, fittingNear, limited));
  const refShapes = refs.slice(0, 600).map((r) => {
    const profile = pipeFittingProfile(r.name);
    const core = profile ? coreGroup(r.group, r.aspect ?? aspect) : null;
    return {
      ...r,
      ...(core ? { group: core } : {}),
      profile,
      coreShapes: core
        ? [0, 1, 2, 3].map((rotation) =>
            shape(core, r.aspect ?? aspect, rotation),
          )
        : [],
      coreAligned: core
        ? [0, 1, 2, 3].map((rotation) =>
            alignedShape(shape(core, r.aspect ?? aspect), rotation),
          )
        : [],
      closedCore: core
        ? closedFittingOutline(core.paths, r.aspect ?? aspect)
        : false,
      aligned: [0, 1, 2, 3].map((rotation) =>
        alignedShape(shape(r.group, r.aspect ?? aspect), rotation),
      ),
      shapes: [0, 1, 2, 3].map((rotation) =>
        shape(r.group, r.aspect ?? aspect, rotation),
      ),
    };
  });
  let matches = 0;
  let fittingMatches = 0;
  const referenceAreas = [
    ...refs.filter((r) => !r.external).map((r) => r.group.box),
    ...templates
      .filter((t) => (!t.reference || t.excludeFromTarget) && validBox(t.box))
      .map((t) => t.box),
  ];
  const geometryMatches: {
    g: Group;
    direct: ReturnType<typeof componentDescription>;
    matched: typeof refShapes;
  }[] = [];
  for (const g of groups) {
    if (
      referenceAreas.some((box) => inside(g.box, box)) ||
      !belongs(g.point, g.box, g.layer)
    )
      continue;
    const direct =
      !g.fittingOnly && g.layer ? componentDescription(g.layer) : null;
    if (!g.fittingOnly && matches > 20000) {
      partial = true;
      continue;
    }
    const own = shape(g, aspect),
      aligned = alignedShape(own),
      gsize = Math.max(
        g.box.right - g.box.left,
        (g.box.bottom - g.box.top) * aspect,
      );
    const nearbyTexts = texts.filter((t) =>
      overlap(g.box, t, 0.012 / Math.max(1, aspect)),
    );
    const closedOwn = g.fittingOnly && closedFittingOutline(g.paths, aspect);
    const matched = refShapes.filter((r) => {
      // Cross-discipline legends often reuse primitive shapes. For an item
      // outside the known piping types, require its own label as corroboration.
      if (
        r.kind === "other" &&
        !r.profile &&
        (!r.abbreviation ||
          !nearbyTexts.some(
            (t) => abbreviationKey(t.text) === abbreviationKey(r.abbreviation!),
          ))
      )
        return false;
      if (!!r.profile !== !!g.fittingOnly) return false;
      if (g.fittingOnly) {
        if (++fittingMatches > 20000) {
          limited();
          return false;
        }
        if (closedOwn !== r.closedCore) return false;
        return (
          r.coreShapes.some((s) => sameShape(own, s)) ||
          r.coreAligned.some((s) => sameShape(aligned, s))
        );
      }
      if (!r.external && r.group.id === g.id) return false;
      const refsize = Math.max(
        r.group.box.right - r.group.box.left,
        (r.group.box.bottom - r.group.box.top) * (r.aspect ?? aspect),
      );
      if (!r.external && (gsize / refsize < 0.35 || gsize / refsize > 3))
        return false;
      if (++matches > 20000) {
        partial = true;
        return false;
      }
      return (
        r.shapes.some((s) => sameShape(own, s)) ||
        r.aligned.some((s) => sameShape(aligned, s))
      );
    });
    geometryMatches.push({ g, direct, matched });
  }
  // A label belongs to the nearest compatible piece of ink, not every symbol
  // inside a large search box. Equidistant labels remain unresolved.
  const labelsByGroup = new Map<string, PipeDrawingText[]>();
  const referenceLabels = new Set(
    refShapes.flatMap((r) =>
      r.abbreviation ? [abbreviationKey(r.abbreviation)] : [],
    ),
  );
  for (const t of texts) {
    const key = abbreviationKey(t.text),
      point = center(t);
    if (!referenceLabels.has(key)) continue;
    const compatible = geometryMatches
      .filter(
        ({ g, matched }) =>
          overlap(g.box, t, 0.012 / Math.max(1, aspect)) &&
          matched.some(
            (r) => r.abbreviation && abbreviationKey(r.abbreviation) === key,
          ),
      )
      .map(({ g }) => ({
        g,
        distance: Math.hypot(
          g.point.x - point.x,
          (g.point.y - point.y) * aspect,
        ),
      }))
      .sort((a, b) => a.distance - b.distance);
    const closest = compatible[0];
    if (
      !closest ||
      (compatible[1] &&
        Math.abs(compatible[1].distance - closest.distance) < 0.00001)
    )
      continue;
    const labels = labelsByGroup.get(closest.g.id) ?? [];
    labels.push(t);
    labelsByGroup.set(closest.g.id, labels);
  }
  const symbolInkPaths = new Set<string>();
  for (const { g, direct, matched } of geometryMatches) {
    const nearbyTexts = labelsByGroup.get(g.id) ?? [];
    // A bow-tie can mean several valve types. A nearby exact abbreviation
    // resolves that ambiguity; array order must never decide the component.
    const tagged = matched.filter(
      (r) =>
        r.abbreviation &&
        nearbyTexts.some(
          (t) => abbreviationKey(t.text) === abbreviationKey(r.abbreviation!),
        ),
    );
    const savedMatches = matched.filter((r) => r.external);
    const choices = tagged.length
      ? tagged
      : savedMatches.length
        ? savedMatches
        : matched;
    const resolvedChoices = choices.flatMap((r) => {
      if (!r.profile) return [r];
      const reach =
        Math.max(
          g.box.right - g.box.left,
          (g.box.bottom - g.box.top) * aspect,
        ) /
          2 +
        0.00015;
      const connection = fittingConnection(
        g,
        fittingNear(g.point, reach).map((v) => v.segment),
        aspect,
      );
      const resolved = resolvePipeFitting(r.profile, connection);
      return resolved
        ? [{ ...r, kind: resolved.kind, name: resolved.name }]
        : [];
    });
    const meanings = new Map(
      resolvedChoices.map((r) => [`${r.kind}:${r.name.toLowerCase()}`, r]),
    );
    const named = meanings.size === 1 ? [...meanings.values()][0] : undefined;
    if (
      named ||
      meanings.size > 1 ||
      direct ||
      g.paths.some((p) => crossing(p, aspect))
    ) {
      // Remove only the actual symbol strokes from the topology pass, never
      // the surrounding area. A pipe may have a real branch inside this box.
      const topologyKind = named?.kind ?? direct?.kind;
      const topologyShape =
        topologyKind && ["tee", "elbow"].includes(topologyKind);
      if (g.fittingOnly || !topologyShape)
        for (const path of g.paths) symbolInkPaths.add(path.id);
    }

    if (
      named &&
      (named.kind !== "other" || tagged.length > 0 || named.profile)
    ) {
      add(
        named.kind,
        named.name,
        g.point,
        g.box,
        "legend",
        named.evidence +
          (tagged.length
            ? `; nearby tag ${named.abbreviation}`
            : "; matching symbol geometry"),
        {
          marker: ["elbow", "tee", "rise", "drop"].includes(named.kind)
            ? customComponentMarker(named.kind, named.name)
            : vectorComponentMarker(g.paths, aspect, named.legendId),
        },
      );
      continue;
    }
    if (
      meanings.size > 1 &&
      [...meanings.values()].some((r) => r.kind !== "other")
    ) {
      const names = [...meanings.values()].map((r) => r.name).join(" / ");
      add(
        [...meanings.values()].every((r) => r.kind === "valve")
          ? "valve"
          : "other",
        "Ambiguous legend symbol",
        g.point,
        g.box,
        "legend",
        `Several legend items share this shape: ${names}. No unique nearby abbreviation resolves it; review required.`,
        { marker: vectorComponentMarker(g.paths, aspect) },
      );
      continue;
    }
    if (direct) {
      add(
        direct.kind,
        direct.name,
        g.point,
        g.box,
        "layer",
        `PDF source layer: ${g.layer}`,
        {
          size: direct.size,
          material: direct.material,
          marker: ["elbow", "tee", "rise", "drop"].includes(direct.kind)
            ? customComponentMarker(direct.kind, direct.name)
            : vectorComponentMarker(g.paths, aspect),
        },
      );
      continue;
    }
    if (!g.fittingOnly && g.paths.some((p) => crossing(p, aspect)))
      add(
        "valve",
        "Possible valve symbol",
        g.point,
        g.box,
        "geometry",
        "Closed crossing symbol lies on the selected pipe. Verify its meaning against the legend.",
        { marker: vectorComponentMarker(g.paths, aspect) },
      );
  }
  // Exact legend abbreviations can identify labelled components even when a
  // vector is unavailable. Require a nearby selected pipe and never guess a prefix.
  const knownAbbreviations = new Map<string, typeof refs>();
  for (const r of refs) {
    if (!r.external || !r.abbreviation) continue;
    const key = abbreviationKey(r.abbreviation);
    if (!/^[A-Z][A-Z0-9-]{1,15}$/.test(key)) continue;
    const list = knownAbbreviations.get(key) ?? [];
    list.push(r);
    knownAbbreviations.set(key, list);
  }
  for (const t of texts) {
    const known = knownAbbreviations.get(abbreviationKey(t.text));
    if (!known) continue;
    const unique = new Map(known.map((r) => [r.name.toLowerCase(), r]));
    if (unique.size !== 1) continue;
    const r = [...unique.values()][0]!,
      point = center(t);
    if (referenceAreas.some((b) => inside(t, b)) || !belongs(point, t))
      continue;
    const existing = candidates.filter(
      (c) =>
        c.locationVerified !== false &&
        overlap(c.box, t, 0.012 / Math.max(1, aspect)),
    );
    if (existing.some((c) => c.name.toLowerCase() === r.name.toLowerCase()))
      continue;
    const nearest = existing.sort(
      (a, b) =>
        Math.hypot(a.point.x - point.x, (a.point.y - point.y) * aspect) -
        Math.hypot(b.point.x - point.x, (b.point.y - point.y) * aspect),
    )[0];
    if (nearest?.source === "geometry" && nearest.kind === r.kind) {
      const labelsHere = texts.filter(
        (label) =>
          overlap(nearest.box, label, 0.012 / Math.max(1, aspect)) &&
          knownAbbreviations.has(abbreviationKey(label.text)),
      );
      const names = new Set(
        labelsHere.flatMap((label) =>
          (knownAbbreviations.get(abbreviationKey(label.text)) ?? []).map(
            (ref) => ref.name.toLowerCase(),
          ),
        ),
      );
      if (names.size !== 1) continue;
      candidates.splice(candidates.indexOf(nearest), 1);
      add(
        r.kind,
        r.name,
        nearest.point,
        nearest.box,
        "legend",
        r.evidence + `; exact tag ${t.text}; symbol geometry not verified`,
        {
          tag: t.text,
          marker: nearest.marker,
        },
      );
    } else if (!nearest) {
      add(
        r.kind,
        r.name,
        point,
        t,
        "legend",
        r.evidence + `; exact tag ${t.text}; component location unresolved`,
        {
          locationVerified: false,
          tag: t.text,
          marker: ["elbow", "tee", "rise", "drop"].includes(r.kind)
            ? customComponentMarker(r.kind, r.name)
            : vectorComponentMarker(
                r.group.paths,
                r.aspect ?? aspect,
                r.legendId,
              ),
        },
      );
    }
  }
  const scheduleHeads = texts.filter((t) => /\bSCHEDULE(?:S)?\b/i.test(t.text));
  for (const d of descriptions.slice(0, 5000)) {
    const point = center(d.text);
    // Legend/schedule descriptions are references, never installed-component counts.
    if (
      [...legendHeads, ...scheduleHeads].some(
        (h) =>
          Math.abs(center(h).x - point.x) < 0.25 &&
          Math.abs(center(h).y - point.y) * aspect < 0.35,
      )
    )
      continue;
    if (!belongs(point, d.text)) continue;
    const nearby = candidates
      .filter(
        (g) =>
          g.locationVerified !== false &&
          g.kind === d.kind &&
          overlap(g.box, d.text, 0.012 / Math.max(1, aspect)),
      )
      .sort(
        (a, b) =>
          Math.hypot(a.point.x - point.x, (a.point.y - point.y) * aspect) -
          Math.hypot(b.point.x - point.x, (b.point.y - point.y) * aspect),
      )[0];
    add(
      d.kind,
      d.name,
      nearby?.point ?? point,
      nearby?.box ?? d.text,
      "tag",
      `Drawing text: ${d.text.text}`,
      {
        size: d.size,
        material: d.material,
        tag: d.tag,
        locationVerified: !!nearby,
        marker: nearby?.marker,
      },
    );
  }
  // Independent topology pass: symbols/labels cannot mask nearby junctions.
  // Give this pass its own spatial-query budget so symbol work cannot starve it.
  // Keep the original selection untouched (including its measured length).
  const topologySegments = selection.segments.filter(
    (s) => !s.id.startsWith("pipe-bridge:") && !symbolInkPaths.has(s.pathId),
  );
  const topologyNear = segmentGrid(topologySegments, aspect, limited);
  type Junction = Parameters<typeof add>;
  const junctionCandidates: Junction[] = [];
  const junctionEvidence = new Map<
    Junction,
    { paths: Set<string>; tolerance: number }
  >();
  // Geometry suggests junctions; it never establishes a fitting SKU, size, or valve subtype.
  const endpointCells = new Map<
    string,
    { point: SheetPoint; segments: PipeSegment[] }[]
  >();
  for (const segment of topologySegments) {
    for (const point of [
      { x: segment.x1, y: segment.y1 },
      { x: segment.x2, y: segment.y2 },
    ]) {
      const key = `${Math.round(point.x / 0.00001)},${Math.round((point.y * aspect) / 0.00001)}`,
        list = endpointCells.get(key) ?? [];
      const group = list[0];
      if (group) {
        if (group.segments.length < 30) group.segments.push(segment);
      } else list.push({ point, segments: [segment] });
      endpointCells.set(key, list);
    }
  }
  let junctions = 0;
  for (const list of endpointCells.values())
    for (const entry of list) {
      if (++junctions > 20000 || junctionCandidates.length >= LIMIT) {
        partial = true;
        break;
      }
      let p = entry.point;
      const tolerance = Math.max(
        0.000015,
        Math.min(0.00015, Math.max(...entry.segments.map((s) => s.width)) / 2),
      );
      const contact =
        entry.segments.length === 1
          ? strokeJunctionAt(
              p,
              entry.segments[0]!,
              topologyNear(p, 0.0003).map(({ segment }) => segment),
              aspect,
              tolerance,
            )
          : null;
      if (contact) p = contact;
      const firstCandidate = junctionCandidates.length;
      const supportPaths = new Set<string>();
      const rays: { x: number; y: number }[] = [];
      const pushRay = (ray: { x: number; y: number }) => {
        if (!rays.some((r) => r.x * ray.x + r.y * ray.y > 0.995))
          rays.push(ray);
      };
      const touching = topologyNear(p, tolerance).map(({ segment }) => segment);
      if (contact) touching.push(entry.segments[0]!);
      for (const s of touching) {
        supportPaths.add(s.pathId);
        if (s.id.startsWith("pipe-bridge:")) continue;
        for (const q of [
          { x: s.x1, y: s.y1 },
          { x: s.x2, y: s.y2 },
        ]) {
          const x = q.x - p.x,
            y = (q.y - p.y) * aspect,
            len = Math.hypot(x, y);
          if (len <= tolerance) continue;
          const dx = s.x2 - s.x1,
            dy = (s.y2 - s.y1) * aspect;
          const length = Math.hypot(dx, dy);
          if (length <= tolerance) continue;
          const sign = x * dx + y * dy >= 0 ? 1 : -1;
          pushRay({ x: (sign * dx) / length, y: (sign * dy) / length });
        }
      }
      let dashed = false;
      if (
        rays.length > 0 &&
        rays.length < 3 &&
        !(
          rays.length === 2 &&
          rays[0]!.x * rays[1]!.x + rays[0]!.y * rays[1]!.y < -0.995
        )
      ) {
        const nearby = topologyNear(p, 0.006).map(({ segment }) => segment);
        if (nearby.length > 256) limited();
        else
          for (const branch of entry.segments) {
            const run = dashedRunAt(p, branch, nearby, aspect, tolerance);
            if (run) {
              pushRay(run);
              pushRay({ x: -run.x, y: -run.y });
              dashed = true;
            }
          }
      }
      const box = {
        left: Math.max(0, p.x - 0.001),
        right: Math.min(1, p.x + 0.001),
        top: Math.max(0, p.y - 0.001 / aspect),
        bottom: Math.min(1, p.y + 0.001 / aspect),
      };
      if (rays.length === 3)
        junctionCandidates.push([
          "tee",
          "Possible tee / branch",
          p,
          box,
          "geometry",
          dashed
            ? "A branch endpoint meets a repeated dashed pipe run across small drafting gaps. Confirm this tee / branch against the drawing."
            : contact
              ? "A branch's printed stroke touches a matching pipe run across a small centerline gap. Confirm this tee / branch against the drawing."
              : "Three pipe directions meet at an endpoint. Confirm whether this represents one physical tee, wye, or another connection.",
          { marker: customComponentMarker("tee", "Tee", rays) },
        ]);
      if (rays.length === 2) {
        const angle =
          (Math.acos(
            Math.max(
              -1,
              Math.min(1, rays[0]!.x * rays[1]!.x + rays[0]!.y * rays[1]!.y),
            ),
          ) *
            180) /
          Math.PI;
        const turn = 180 - angle;
        const nominal = [90, 45, 22.5].find(
          (value) => Math.abs(turn - value) < 4,
        );
        if (nominal !== undefined)
          junctionCandidates.push([
            "elbow",
            `Possible ${nominal}° elbow`,
            p,
            box,
            "geometry",
            "Pipe linework changes direction here. It may represent an elbow, a bend, or a schematic change; verify it.",
            {
              marker: customComponentMarker("elbow", `${nominal}° elbow`, rays),
            },
          ]);
      }
      for (const candidate of junctionCandidates.slice(firstCandidate)) {
        junctionEvidence.set(candidate, { paths: supportPaths, tolerance });
      }
    }
  const sameJunction = (a: Junction, b: Junction) => {
    const ae = junctionEvidence.get(a)!,
      be = junctionEvidence.get(b)!;
    return (
      Math.hypot(a[2].x - b[2].x, (a[2].y - b[2].y) * aspect) <=
        Math.max(ae.tolerance, be.tolerance) &&
      [...ae.paths].filter((id) => be.paths.has(id)).length >= 2
    );
  };
  const mergedJunctions: Junction[] = [];
  // Combine only after both passes finish. Deduplicate by kind and physical
  // anchor, not by overlapping marker boxes (which can cover adjacent fittings).
  for (const junction of junctionCandidates) {
    const [kind, , point] = junction;
    // At a small drafting gap, one endpoint can see only two arms of a tee.
    // Prefer the three-arm result only when both observations share pipe ink.
    if (
      kind === "elbow" &&
      junctionCandidates.some(
        (other) => other[0] === "tee" && sameJunction(junction, other),
      )
    )
      continue;
    if (
      mergedJunctions.some(
        (other) => other[0] === kind && sameJunction(junction, other),
      )
    )
      continue;
    mergedJunctions.push(junction);
    if (
      candidates.some(
        (c) =>
          c.locationVerified !== false &&
          c.kind === kind &&
          Math.hypot(c.point.x - point.x, (c.point.y - point.y) * aspect) <=
            0.00002,
      )
    )
      continue;
    add(...junction);
  }
  if (refs.length === 0)
    warnings.push(
      "No usable legend references are available. Review and save Legend Items for this drawing set, or teach a symbol from this sheet.",
    );
  warnings.push(
    "Candidates require review. Sizes and materials are shown only when explicitly stated; blank values are unknown.",
  );
  if (partial)
    warnings.push(
      "Component analysis is partial because drawing or analysis limits were reached.",
    );
  return {
    candidates: candidates.sort(
      (a, b) => a.point.y - b.point.y || a.point.x - b.point.x,
    ),
    warnings,
    partial,
  };
}
