import type { DrawingMetadata } from "./drawing-workspace";
import type { PipeLinework } from "./pipe-system";
import type { SheetScale } from "./sheet-measure";
export type RevisionSheet = {
  id: string;
  setId: string;
  name: string;
  metadata: DrawingMetadata;
};
export function revisionNumber(sheet: RevisionSheet) {
  const raw = (sheet.metadata.number || sheet.name)
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[\u2010-\u2015\u2212]/g, "-");
  return /^(?:[A-Z]{1,4}[-. ]?\d{1,4}(?:[.-]\d{1,4})?[A-Z]?|\d{1,4})$/.test(raw)
    ? raw.replace(/[-\s]/g, "")
    : "";
}
export function proposeDrawingRevisions(
  incoming: RevisionSheet[],
  existing: RevisionSheet[],
) {
  return incoming.map((sheet) => {
    const number = revisionNumber(sheet);
    const candidates = number
      ? existing.filter((target) => revisionNumber(target) === number)
      : [];
    const duplicate =
      number &&
      incoming.filter((other) => revisionNumber(other) === number).length > 1;
    return {
      sourceId: sheet.id,
      number: sheet.metadata.number || sheet.name,
      status:
        !number || duplicate || candidates.length > 1
          ? ("uncertain" as const)
          : candidates.length
            ? ("matched" as const)
            : ("new" as const),
      targetId:
        !duplicate && candidates.length === 1 ? candidates[0]!.id : null,
      reason: !number
        ? "Drawing number was not identified."
        : duplicate
          ? "This upload repeats this drawing number."
          : candidates.length > 1
            ? "Several existing drawings have this number."
            : candidates.length
              ? "Unique drawing-number match."
              : "No existing drawing has this number.",
    };
  });
}
export type RevisionScaleEvidence = {
  width: number;
  height: number;
  scale: SheetScale | null;
  words?: Array<{
    text: string;
    left: number;
    top: number;
    right: number;
    bottom: number;
  }>;
};
function meters(scale: SheetScale) {
  return scale.unitsPerSheetWidth * (scale.unit === "ft" ? 0.3048 : 1);
}
export function revisionGeometry(work: PipeLinework) {
  const keys = new Set<string>(),
    cells = new Set<string>();
  for (const s of work.segments) {
    const values = [s.x1, s.y1, s.x2, s.y2];
    if (
      !values.every(Number.isFinite) ||
      values.some((v) => v < 0.08 || v > 0.85)
    )
      continue;
    if (Math.hypot(s.x2 - s.x1, (s.y2 - s.y1) * work.aspect) < 0.015) continue;
    const a = `${Math.round(s.x1 * 100000)},${Math.round(s.y1 * 100000)}`,
      b = `${Math.round(s.x2 * 100000)},${Math.round(s.y2 * 100000)}`;
    keys.add([a, b].sort().join(":"));
    cells.add(
      `${Math.floor(((s.x1 + s.x2) / 2) * 4)},${Math.floor(((s.y1 + s.y2) / 2) * 4)}`,
    );
  }
  return { keys, cells };
}
/** Printed global scale plus distributed, unchanged model-space geometry; never dimensions alone. */
export function compatibleRevisionScale(
  current: SheetScale | null,
  old: RevisionScaleEvidence | null,
  next: RevisionScaleEvidence | null,
  before: PipeLinework | null,
  after: PipeLinework | null,
) {
  if (!current)
    return {
      preserve: false,
      reason: "No calibration is saved; set scale before measuring.",
    };
  if (
    !old?.scale ||
    !next?.scale ||
    !before ||
    !after ||
    before.truncated ||
    after.truncated
  )
    return {
      preserve: false,
      reason:
        "Scale compatibility could not be verified. Check calibration before measuring.",
    };
  const close = (a: number, b: number) =>
    a > 0 && b > 0 && Math.abs(a - b) / Math.max(a, b) <= 0.001;
  if (
    !close(meters(current), meters(old.scale)) ||
    !close(meters(old.scale), meters(next.scale)) ||
    !close(before.aspect, after.aspect)
  )
    return {
      preserve: false,
      reason:
        "Printed scale, page geometry, or saved calibration changed. Check calibration before measuring.",
    };
  const a = revisionGeometry(before),
    b = revisionGeometry(after);
  const common = [...a.keys].filter((key) => b.keys.has(key)).length;
  if (
    a.keys.size < 80 ||
    b.keys.size < 80 ||
    a.cells.size < 6 ||
    b.cells.size < 6 ||
    common / Math.max(a.keys.size, b.keys.size) < 0.98
  )
    return {
      preserve: false,
      reason:
        "Drawing geometry changed or has insufficient comparable detail. Check calibration before measuring.",
    };
  return {
    preserve: true,
    reason:
      "Printed scale and distributed drawing geometry agree; calibration will be retained.",
  };
}

export type RevisionRegion = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export function revisionChangedRegions(
  old: RevisionScaleEvidence | null,
  next: RevisionScaleEvidence | null,
  before: PipeLinework | null,
  after: PipeLinework | null,
) {
  if (
    !before ||
    !after ||
    before.truncated ||
    after.truncated ||
    !old?.words ||
    !next?.words
  )
    return { aligned: false, regions: [] as RevisionRegion[] };
  if (
    !old.scale ||
    !next.scale ||
    Math.abs(meters(old.scale) - meters(next.scale)) /
      Math.max(meters(old.scale), meters(next.scale)) >
      0.001
  )
    return { aligned: false, regions: [] as RevisionRegion[] };
  const a = revisionGeometry(before),
    b = revisionGeometry(after);
  const common = [...a.keys].filter((key) => b.keys.has(key)).length;
  const aligned =
    a.keys.size >= 80 &&
    b.keys.size >= 80 &&
    a.cells.size >= 6 &&
    b.cells.size >= 6 &&
    common / Math.max(a.keys.size, b.keys.size) >= 0.98 &&
    Math.abs(before.aspect - after.aspect) < 0.0001;
  if (!aligned) return { aligned: false, regions: [] as RevisionRegion[] };
  const records = (work: PipeLinework, evidence: RevisionScaleEvidence) => [
    ...work.segments
      .filter((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 0.005)
      .map((s) => ({
        key: [
          `${Math.round(s.x1 * 100000)},${Math.round(s.y1 * 100000)}`,
          `${Math.round(s.x2 * 100000)},${Math.round(s.y2 * 100000)}`,
        ]
          .sort()
          .join(":"),
        left: Math.min(s.x1, s.x2),
        top: Math.min(s.y1, s.y2),
        right: Math.max(s.x1, s.x2),
        bottom: Math.max(s.y1, s.y2),
      })),
    ...(evidence.words ?? []).map((w) => ({
      ...w,
      key: `text:${w.text}:${Math.round(w.left * 100000)}:${Math.round(w.top * 100000)}:${Math.round(w.right * 100000)}`,
    })),
  ];
  const previous = records(before, old),
    current = records(after, next),
    previousKeys = new Set(previous.map((r) => r.key)),
    currentKeys = new Set(current.map((r) => r.key));
  const regions = [
    ...previous.filter((r) => !currentKeys.has(r.key)),
    ...current.filter((r) => !previousKeys.has(r.key)),
  ];
  // Excessive change is ambiguous alignment, not 10,000 confidently located errors.
  return regions.length > 10000
    ? { aligned: false, regions: [] as RevisionRegion[] }
    : { aligned: true, regions };
}
export function nearRevisionChanges(
  points: Array<{ x: number; y: number }>,
  regions: RevisionRegion[],
) {
  if (!points.length) return true;
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const box = {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
  return regions.some(
    (r) =>
      box.left <= r.right + 0.02 &&
      box.right >= r.left - 0.02 &&
      box.top <= r.bottom + 0.02 &&
      box.bottom >= r.top - 0.02,
  );
}
