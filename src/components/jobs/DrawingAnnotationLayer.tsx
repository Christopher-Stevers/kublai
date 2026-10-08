"use client";

import type { DrawingEntity, DrawingMarkup } from "~/lib/drawing-workspace";
import type { SheetScale } from "~/lib/sheet-measure";
import { drawingMarkupBounds } from "~/lib/drawing-annotation-geometry";
import { DrawingAnnotationSvg } from "./DrawingAnnotationSvg";

export function DrawingAnnotationLayer({ annotations, aspect, selectedId, draft, editing, hidden, sharedScale, onSelect, screenPixelSize = 1, showResizeHandles = true, canEditAnnotation }: {
  annotations: DrawingEntity[]; aspect: number; selectedId?: string | null;
  draft?: DrawingMarkup | null; editing?: { id: string; data: DrawingMarkup } | null;
  hidden?: boolean; sharedScale?: SheetScale | null; onSelect?: (id: string) => void; screenPixelSize?: number;
  showResizeHandles?: boolean; canEditAnnotation?: (entityId: string) => boolean;
}) {
  return <svg className="pointer-events-none absolute inset-0 z-[3] h-full w-full overflow-visible" viewBox={`0 0 1000 ${1000 * aspect}`} aria-label="Drawing annotations">
    {!hidden && annotations.filter(entity => entity.visibility !== "archived").map(entity => {
      if (entity.kind !== "markup" && entity.kind !== "issue") return null;
      const selected = entity.id === selectedId;
      const data = entity.kind === "markup" ? editing?.id === entity.id ? editing.data : entity.data : null;
      const bounds = data && selected ? drawingMarkupBounds(data, aspect) : null;
      const editable = selected && showResizeHandles && (canEditAnnotation?.(entity.id) ?? true);
      const vertices = data && ["line", "arrow", "dimension", "polyline", "polycloud", "area", "angle", "count"].includes(data.type);
      return <g key={entity.id} data-annotation-id={entity.id} tabIndex={0} role="button"
        aria-label={entity.kind === "issue" ? `${entity.data.type === "rfi" ? "RFI" : "Issue"}: ${entity.data.title}` : `${entity.data.type} markup${entity.data.text ? `: ${entity.data.text}` : ""}`}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onSelect?.(entity.id); } }}
        style={{ pointerEvents: "visiblePainted", cursor: "pointer" }}>
        {data ? <>
          <DrawingAnnotationSvg data={data} aspect={aspect} sharedScale={sharedScale} />
          {data.type !== "text" && <polyline points={data.points.map(p => `${p.x * 1000},${p.y * 1000 * aspect}`).join(" ")} fill="none" stroke="transparent" strokeWidth={Math.max(18, data.width + 12)} />}
          {bounds && <rect x={bounds.left * 1000} y={bounds.top * 1000 * aspect} width={(bounds.right - bounds.left) * 1000} height={(bounds.bottom - bounds.top) * 1000 * aspect}
            fill="none" stroke="#2563eb" strokeWidth={screenPixelSize} strokeDasharray={`${4 * screenPixelSize} ${3 * screenPixelSize}`} pointerEvents="none" />}
          {editable && bounds && ([["nw", bounds.left, bounds.top], ["ne", bounds.right, bounds.top], ["sw", bounds.left, bounds.bottom], ["se", bounds.right, bounds.bottom]] as const).map(([corner, x, y]) => <g key={corner} data-annotation-handle={corner} aria-label={`Resize markup ${corner}`} style={{ cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize" }}>
            <circle cx={x * 1000} cy={y * 1000 * aspect} r={18 * screenPixelSize} fill="transparent" />
            <rect x={x * 1000 - 5 * screenPixelSize} y={y * 1000 * aspect - 5 * screenPixelSize} width={10 * screenPixelSize} height={10 * screenPixelSize} fill="#ffffff" stroke="#2563eb" strokeWidth={1.5 * screenPixelSize} />
          </g>)}
          {editable && vertices && data.points.length <= 100 && data.points.map((point, index) => <g key={index} data-annotation-handle={index} aria-label={`Edit markup point ${index + 1}`} style={{ cursor: "crosshair" }}>
            <circle cx={point.x * 1000} cy={point.y * 1000 * aspect} r={18 * screenPixelSize} fill="transparent" />
            <circle cx={point.x * 1000} cy={point.y * 1000 * aspect} r={5 * screenPixelSize} fill="#ffffff" stroke="#2563eb" strokeWidth={1.5 * screenPixelSize} />
          </g>)}
        </> : entity.kind === "issue" && <g transform={`translate(${entity.data.point.x * 1000} ${entity.data.point.y * 1000 * aspect}) scale(${screenPixelSize})`}>
          <path d="M 0 0 C -7 -9 -16 -17 -16 -27 A 16 16 0 1 1 16 -27 C 16 -17 7 -9 0 0 Z" fill={entity.data.status === "closed" ? "#16a34a" : entity.data.type === "rfi" ? "#7c3aed" : "#ea580c"} stroke={selected ? "#2563eb" : "#ffffff"} strokeWidth={3} />
          <text x={0} y={-24} textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight="bold" fill="#ffffff">{entity.data.type === "rfi" ? "?" : "!"}</text>
        </g>}
      </g>;
    })}
    {draft && draft.points.length > 0 && <g opacity={0.75}>
      <DrawingAnnotationSvg data={draft} aspect={aspect} sharedScale={sharedScale} />
      {!["freehand", "highlight", "count"].includes(draft.type) && draft.points.slice(-50).map((point, index) => <circle key={index} cx={point.x * 1000} cy={point.y * 1000 * aspect} r={4 * screenPixelSize} fill={draft.stroke} />)}
    </g>}
  </svg>;
}
