"use client";

import { memo, type Ref } from "react";
import type { DrawingEntity, DrawingMarkup } from "~/lib/drawing-workspace";
import type { LengthUnit, SheetScale } from "~/lib/sheet-measure";
import {
  drawingMarkupBounds,
  drawingLinePath,
  drawingBounds,
} from "~/lib/drawing-annotation-geometry";
import { DrawingAnnotationSvg } from "./DrawingAnnotationSvg";

type DrawingAnnotationLayerProps = {
  annotations: DrawingEntity[];
  aspect: number;
  selectedId?: string | null;
  /** A markup being held before it is picked up; it shakes. */
  heldId?: string | null;
  draft?: DrawingMarkup | null;
  editing?: { id: string; data: DrawingMarkup } | null;
  hidden?: boolean;
  /** Keep ink visible while allowing every gesture to pass through to the viewer. */
  interactive?: boolean;
  sharedScale?: SheetScale | null;
  displayUnit?: LengthUnit;
  onSelect?: (id: string) => void;
  onActivate?: (markup: DrawingMarkup) => void;
  screenPixelSize?: number;
  sheetPixelSize?: number;
  showResizeHandles?: boolean;
  showMoveArea?: boolean;
  canEditAnnotation?: (entityId: string) => boolean;
  /** Live SVG camera used by the viewer; printable layers keep the full sheet. */
  viewportRef?: Ref<SVGSVGElement>;
  viewBox?: string;
  /** Viewer owns a buffered camera imperatively; React must not reset it on pan. */
  bufferedViewport?: boolean;
};

/** Saved geometry is independent of viewport movement; only one edited entity changes. */
const SavedMarkupSvg = memo(DrawingAnnotationSvg);
const SavedAnnotation = memo(function SavedAnnotation({
  entity,
  data,
  selected,
  held = false,
  interactive,
  canEdit,
  aspect,
  sharedScale,
  displayUnit,
  onSelect,
  onActivate,
  screenPixelSize,
  sheetPixelSize,
  showResizeHandles,
  showMoveArea,
}: {
  entity: DrawingEntity;
  data: DrawingMarkup | null;
  selected: boolean;
  held?: boolean;
  canEdit: boolean;
} & Pick<
  DrawingAnnotationLayerProps,
  | "aspect"
  | "interactive"
  | "sharedScale"
  | "displayUnit"
  | "onSelect"
  | "onActivate"
  | "sheetPixelSize"
  | "showResizeHandles"
  | "showMoveArea"
> & { screenPixelSize: number }) {
  if (entity.kind !== "markup" && entity.kind !== "issue") return null;
  const linkBounds = data?.type === "link" ? drawingBounds(data.points) : null;
  const bounds = data && selected ? drawingMarkupBounds(data, aspect) : null;
  const editable = canEdit && showResizeHandles;
  const vertices =
    data &&
    [
      "line",
      "arrow",
      "dimension",
      "polyline",
      "polycloud",
      "area",
      "angle",
      "count",
    ].includes(data.type);
  return (
    <g
      key={entity.id}
      data-annotation-id={entity.id}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? "button" : undefined}
      aria-label={
        entity.kind === "issue"
          ? `${entity.data.type === "rfi" ? "RFI" : "Issue"}: ${entity.data.title}`
          : `${entity.data.type} markup${entity.data.text ? `: ${entity.data.text}` : ""}`
      }
      onKeyDown={(event) => {
        if (!interactive) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          if (data?.type === "link" && onActivate) onActivate(data);
          else onSelect?.(entity.id);
        }
      }}
      // A tap must not paint the browser's grey highlight or focus box around the markup.
      className={
        !interactive
          ? "pointer-events-none [&_*]:!pointer-events-none outline-none"
          : selected || held ? "annotation-shake outline-none" : "outline-none"
      }
      style={{
        pointerEvents: interactive ? "visiblePainted" : "none",
        cursor: interactive ? "pointer" : undefined,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {data ? (
        <>
          {bounds && canEdit && showMoveArea && data.type !== "dimension" && (
            <rect
              data-annotation-move-area=""
              x={bounds.left * 1000}
              y={bounds.top * 1000 * aspect}
              width={(bounds.right - bounds.left) * 1000}
              height={(bounds.bottom - bounds.top) * 1000 * aspect}
              fill="transparent"
              pointerEvents={interactive ? "all" : "none"}
              style={{ cursor: "move" }}
            />
          )}
          {linkBounds && (
            <rect
              data-link-hit-area=""
              x={linkBounds.left * 1000}
              y={linkBounds.top * 1000 * aspect}
              width={(linkBounds.right - linkBounds.left) * 1000}
              height={(linkBounds.bottom - linkBounds.top) * 1000 * aspect}
              fill="transparent"
              pointerEvents={interactive ? "all" : "none"}
            />
          )}
          <SavedMarkupSvg
            data={data}
            aspect={aspect}
            sharedScale={sharedScale}
            displayUnit={displayUnit}
            screenPixelSize={
              (data.type === "dimension" && data.parents) || data.pipeComponent
                ? screenPixelSize
                : undefined
            }
            sheetPixelSize={
              data.type === "dimension" && data.parents
                ? sheetPixelSize
                : undefined
            }
          />
          {data.type !== "text" &&
            (data.parents ? (
              <path
                d={drawingLinePath(data, aspect)}
                fill="none"
                stroke="transparent"
                // Measurement selection stays within three screen pixels of the line,
                // even while the SVG camera zooms without a React render.
                data-measurement-hit-area={data.type === "dimension" ? "" : undefined}
                strokeWidth={data.type === "dimension" ? 6 : Math.max(18, data.width + 12)}
                vectorEffect={data.type === "dimension" ? "non-scaling-stroke" : undefined}
                pointerEvents={data.type === "dimension" ? "stroke" : undefined}
              />
            ) : (
              <polyline
                points={data.points
                  .map((p) => `${p.x * 1000},${p.y * 1000 * aspect}`)
                  .join(" ")}
                fill="none"
                stroke="transparent"
                // Measurement selection stays within three screen pixels of the line,
                // even while the SVG camera zooms without a React render.
                data-measurement-hit-area={data.type === "dimension" ? "" : undefined}
                strokeWidth={data.type === "dimension" ? 6 : Math.max(18, data.width + 12)}
                vectorEffect={data.type === "dimension" ? "non-scaling-stroke" : undefined}
                pointerEvents={data.type === "dimension" ? "stroke" : undefined}
              />
            ))}
          {bounds && (
            <rect
              x={bounds.left * 1000}
              y={bounds.top * 1000 * aspect}
              width={(bounds.right - bounds.left) * 1000}
              height={(bounds.bottom - bounds.top) * 1000 * aspect}
              fill="none"
              stroke="#2563eb"
              strokeWidth={screenPixelSize}
              strokeDasharray={`${4 * screenPixelSize} ${3 * screenPixelSize}`}
              pointerEvents="none"
            />
          )}
          {editable &&
            bounds &&
            (
              [
                ["nw", bounds.left, bounds.top],
                ["ne", bounds.right, bounds.top],
                ["sw", bounds.left, bounds.bottom],
                ["se", bounds.right, bounds.bottom],
              ] as const
            ).map(([corner, x, y]) => (
              <g
                key={corner}
                data-annotation-handle={corner}
                aria-label={`Resize markup ${corner}`}
                style={{
                  cursor:
                    corner === "nw" || corner === "se"
                      ? "nwse-resize"
                      : "nesw-resize",
                }}
              >
                <circle
                  cx={x * 1000}
                  cy={y * 1000 * aspect}
                  r={(data.type === "dimension" ? 7 : 18) * screenPixelSize}
                  fill="transparent"
                />
                <rect
                  x={x * 1000 - 5 * screenPixelSize}
                  y={y * 1000 * aspect - 5 * screenPixelSize}
                  width={10 * screenPixelSize}
                  height={10 * screenPixelSize}
                  fill="#ffffff"
                  stroke="#2563eb"
                  strokeWidth={1.5 * screenPixelSize}
                />
              </g>
            ))}
          {editable &&
            vertices &&
            data.points.length <= 100 &&
            data.points.map((point, index) => (
              <g
                key={index}
                data-annotation-handle={index}
                aria-label={`Edit markup point ${index + 1}`}
                style={{ cursor: "crosshair" }}
              >
                <circle
                  cx={point.x * 1000}
                  cy={point.y * 1000 * aspect}
                  r={(data.type === "dimension" ? 7 : 18) * screenPixelSize}
                  fill="transparent"
                />
                <circle
                  cx={point.x * 1000}
                  cy={point.y * 1000 * aspect}
                  r={5 * screenPixelSize}
                  fill="#ffffff"
                  stroke="#2563eb"
                  strokeWidth={1.5 * screenPixelSize}
                />
              </g>
            ))}
        </>
      ) : (
        entity.kind === "issue" && (
          <g
            transform={`translate(${entity.data.point.x * 1000} ${entity.data.point.y * 1000 * aspect}) scale(${screenPixelSize})`}
          >
            <path
              d="M 0 0 C -7 -9 -16 -17 -16 -27 A 16 16 0 1 1 16 -27 C 16 -17 7 -9 0 0 Z"
              fill={
                entity.data.status === "closed"
                  ? "#16a34a"
                  : entity.data.type === "rfi"
                    ? "#7c3aed"
                    : "#ea580c"
              }
              stroke={selected ? "#2563eb" : "#ffffff"}
              strokeWidth={3}
            />
            <text
              x={0}
              y={-24}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={13}
              fontWeight="bold"
              fill="#ffffff"
            >
              {entity.data.type === "rfi" ? "?" : "!"}
            </text>
          </g>
        )
      )}
    </g>
  );
});

export const DrawingAnnotationLayer = memo(function DrawingAnnotationLayer({
  annotations,
  aspect,
  selectedId,
  heldId,
  draft,
  editing,
  hidden,
  interactive = true,
  sharedScale,
  displayUnit,
  onSelect,
  onActivate,
  screenPixelSize = 1,
  sheetPixelSize,
  showResizeHandles = true,
  showMoveArea = false,
  canEditAnnotation,
  viewportRef,
  viewBox,
  bufferedViewport,
}: DrawingAnnotationLayerProps) {
  // Clip the live camera so offscreen ink/masks do not paint a huge sheet
  // surface. Printable layers can still extend beyond sheet edges.
  const ink = (
    <svg
      ref={viewportRef}
      className={`pointer-events-none absolute inset-0 z-[3] h-full w-full ${viewBox || bufferedViewport ? "overflow-hidden" : "overflow-visible"}`}
      viewBox={viewBox ?? `0 0 1000 ${1000 * aspect}`}
      aria-label="Drawing annotations"
    >
      {!hidden &&
        annotations
          .filter((entity) => entity.visibility !== "archived")
          .map((entity) => {
            if (entity.kind !== "markup" && entity.kind !== "issue")
              return null;
            const selected = interactive && entity.id === selectedId;
            const data =
              entity.kind === "markup"
                ? editing?.id === entity.id
                  ? editing.data
                  : entity.data
                : null;
            // Ordinary ink uses sheet coordinates. Pins, handles and measurement
            // labels keep their screen size and must still follow changes in zoom.
            const usesScreenSize =
              selected ||
              entity.kind === "issue" ||
              Boolean(data?.type === "dimension" && data.parents) || Boolean(data?.pipeComponent);
            return (
              <SavedAnnotation
                key={entity.id}
                entity={entity}
                data={data}
                selected={selected}
                held={interactive && entity.id === heldId}
                interactive={interactive}
                canEdit={selected && (canEditAnnotation?.(entity.id) ?? true)}
                aspect={aspect}
                sharedScale={sharedScale}
                displayUnit={displayUnit}
                onSelect={onSelect}
                onActivate={onActivate}
                screenPixelSize={usesScreenSize ? screenPixelSize : 1}
                sheetPixelSize={
                  data?.type === "dimension" && data.parents
                    ? sheetPixelSize
                    : undefined
                }
                showResizeHandles={showResizeHandles}
                showMoveArea={showMoveArea}
              />
            );
          })}
      {draft && draft.points.length > 0 && (
        <g opacity={0.75}>
          <DrawingAnnotationSvg
            data={draft}
            aspect={aspect}
            sharedScale={sharedScale}
            displayUnit={displayUnit}
            screenPixelSize={screenPixelSize}
            sheetPixelSize={sheetPixelSize}
          />
          {!["freehand", "highlight", "count"].includes(draft.type) &&
            draft.points
              .slice(-50)
              .map((point, index) => (
                <circle
                  key={index}
                  cx={point.x * 1000}
                  cy={point.y * 1000 * aspect}
                  r={4 * screenPixelSize}
                  fill={draft.stroke}
                />
              ))}
        </g>
      )}
    </svg>
  );
  return bufferedViewport ? (
    <div data-annotation-pan-surface="" className="pointer-events-none absolute left-0 top-0 z-[3] h-full w-full">
      {ink}
    </div>
  ) : ink;
});
