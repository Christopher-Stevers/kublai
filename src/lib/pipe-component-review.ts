import type { DrawingEntity, DrawingMarkup } from "./drawing-workspace";
import type {
  PipeComponentCandidate,
  PipeSymbolTemplate,
} from "./pipe-components-types";

/** Immutable source URL/page, not a user or organization identifier. */
export function pipeComponentSourceKey(url: string, page: number) {
  let h = 2166136261;
  const value = `${url}:${page}`;
  for (let i = 0; i < value.length; i++)
    h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return `pdf-${(h >>> 0).toString(16)}-${page}`;
}
export function pipeSymbolTemplates(
  annotations: DrawingEntity[],
  sourceKey: string,
): PipeSymbolTemplate[] {
  return annotations.flatMap((entity) => {
    if (entity.kind !== "markup" || entity.visibility === "archived") return [];
    const data = entity.data,
      meta = data.pipeSymbolTemplate;
    const a = data.points[0],
      b = data.points[1];
    if (meta?.sourceKey !== sourceKey || !a || !b) return [];
    return [
      {
        id: entity.id,
        kind: meta.kind,
        name: meta.name,
        box: {
          left: Math.min(a.x, b.x),
          right: Math.max(a.x, b.x),
          top: Math.min(a.y, b.y),
          bottom: Math.max(a.y, b.y),
        },
      },
    ];
  });
}
export function reviewedPipeComponent(
  annotations: DrawingEntity[],
  sourceKey: string,
  candidate: PipeComponentCandidate,
) {
  return annotations.find((entity) => {
    if (entity.kind !== "markup" || entity.visibility === "archived")
      return false;
    const data = entity.data,
      meta = data.pipeComponent,
      p = data.points[0];
    return (
      data.type === "count" &&
      meta?.sourceKey === sourceKey &&
      meta.candidateId === candidate.id &&
      meta.fingerprint === candidate.fingerprint &&
      !!p &&
      Math.hypot(p.x - candidate.point.x, p.y - candidate.point.y) < 0.00001
    );
  });
}
export function pipeComponentsCsv(records: DrawingMarkup[]) {
  const cell = (value: string | number | null | undefined) => {
    let text = value == null ? "" : String(value);
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows: (string | number | null | undefined)[][] = [
    [
      "Name",
      "Type",
      "Size",
      "Material",
      "System",
      "Quantity",
      "Sheet ID",
      "X",
      "Y",
      "Evidence",
      "Status",
    ],
  ];
  for (const data of records) {
    const meta = data.pipeComponent,
      point = data.points[0];
    if (!meta || !point) continue;
    rows.push([
      meta.name,
      meta.kind,
      meta.size,
      meta.material,
      meta.system,
      1,
      data.sourceSheetId,
      point.x,
      point.y,
      meta.evidence,
      "Reviewed",
    ]);
  }
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
