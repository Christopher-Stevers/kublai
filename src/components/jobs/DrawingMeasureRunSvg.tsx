import { DrawingMeasureNode } from "./DrawingMeasureNode";
import { measurementStrokeBands } from "~/lib/measurement-stroke-bands";
import type { DrawingMarkup } from "~/lib/drawing-workspace";
import {
  drawingMarkupEdges,
  drawingMeasurement,
  drawingBounds,
} from "~/lib/drawing-annotation-geometry";
import {
  formatLengthAs,
  realLength,
  type LengthUnit,
  type SheetScale,
} from "~/lib/sheet-measure";
import { measureColorHalo, measureLineScale } from "~/lib/sheet-measure-color";
import { sheetMeasureStyle } from "~/lib/sheet-measure-style";
import { savedMeasureAngleArcs } from "~/lib/saved-measure-run";

/** Completed Measure runs keep the same screen-sized marks as the active tool. */
export function DrawingMeasureRunSvg({
  data,
  aspect,
  sharedScale,
  displayUnit,
  showAngles = false,
  screenPixelSize,
  sheetPixelSize,
}: {
  data: DrawingMarkup;
  aspect: number;
  sharedScale?: SheetScale | null;
  displayUnit?: LengthUnit;
  showAngles?: boolean;
  screenPixelSize: number;
  sheetPixelSize?: number;
}) {
  const style = sheetMeasureStyle(
    screenPixelSize,
    sheetPixelSize ?? screenPixelSize,
  );
  const halo = measureColorHalo(data.stroke);
  // The chosen line width thickens the run's line; width 2 is the usual look.
  const line = style.stroke * measureLineScale(data.width);
  const points = data.points.map((point) => ({
    x: point.x * 1000,
    y: point.y * 1000 * aspect,
  }));
  const bounds = drawingBounds(points);
  const edges = drawingMarkupEdges(data);
  const bands = measurementStrokeBands(points, edges, style.arm * 1.2);
  const angles = showAngles
    ? savedMeasureAngleArcs(data, aspect, screenPixelSize)
    : [];
  const storedUnit = data.unit ?? sharedScale?.unit;
  const rawScale = data.scale ?? sharedScale?.unitsPerSheetWidth;
  const baseUnit = storedUnit === "ft" || storedUnit === "in" ? "ft" : "m";
  const scale =
    rawScale &&
    (storedUnit === "mm"
      ? rawScale / 1000
      : storedUnit === "cm"
        ? rawScale / 100
        : storedUnit === "in"
          ? rawScale / 12
          : rawScale);
  return (
    <g opacity={data.opacity ?? 1} data-saved-measure-run="true">
      {bands.map(
        (path, index) =>
          path && (
            <g key={index} opacity={index === 3 ? 1 : (index + 0.5) / 3}>
              <path
                d={path}
                fill="none"
                stroke={halo}
                strokeOpacity={0.85}
                strokeWidth={line * 2.2}
                strokeLinecap="butt"
              />
              <path
                data-saved-measure-path={index === 3 ? "true" : undefined}
                d={path}
                fill="none"
                stroke={data.stroke}
                strokeWidth={line}
                strokeLinecap="butt"
              />
            </g>
          ),
      )}
      {edges.map(({ from, to }) => {
        const a = points[from]!,
          b = points[to]!;
        let rotation = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        if (rotation > 90) rotation -= 180;
        if (rotation < -90) rotation += 180;
        const length =
          scale && storedUnit
            ? !displayUnit && storedUnit === "cm"
              ? `${(realLength([data.points[from]!, data.points[to]!], aspect, scale) * 100).toFixed(2)} cm`
              : formatLengthAs(
                  realLength(
                    [data.points[from]!, data.points[to]!],
                    aspect,
                    scale,
                  ),
                  baseUnit,
                  displayUnit ?? (storedUnit === "cm" ? "m" : storedUnit),
                )
            : "Set scale";
        return (
          <g
            key={to}
            transform={`translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2}) rotate(${rotation})`}
            data-measurement-segment={to}
          >
            <text
              y={style.labelOffset}
              textAnchor="middle"
              fontSize={style.font}
              fontWeight={style.fontWeight}
              fill={data.stroke}
              stroke={halo}
              strokeWidth={style.labelHalo}
              strokeLinejoin="round"
              paintOrder="stroke"
            >
              {length}
            </text>
          </g>
        );
      })}
      {angles.map((arc) => (
        <g key={arc.index} data-saved-measure-angle={arc.index}>
          {arc.referenceEnd && (
            <line
              x1={arc.vertex.x}
              y1={arc.vertex.y}
              x2={arc.referenceEnd.x}
              y2={arc.referenceEnd.y}
              stroke={data.stroke}
              strokeWidth={style.stroke}
              strokeDasharray={`${3 * screenPixelSize} ${3 * screenPixelSize}`}
            />
          )}
          <path
            d={arc.path}
            fill="none"
            stroke={halo}
            strokeWidth={style.stroke * 3}
          />
          <path
            data-saved-angle-arc="true"
            d={arc.path}
            fill="none"
            stroke={data.stroke}
            strokeWidth={style.stroke * 1.4}
          />
          <text
            x={arc.label.x}
            y={arc.label.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={style.angleFont}
            fontWeight={700}
            fill={data.stroke}
            stroke={halo}
            strokeWidth={style.angleHalo}
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            {arc.text}
          </text>
        </g>
      ))}
      {edges.length > 1 && (
        <text
          data-saved-measure-total="true"
          x={(bounds.left + bounds.right) / 2}
          y={bounds.top + style.labelOffset}
          textAnchor="middle"
          fontSize={style.font}
          fontWeight={style.fontWeight}
          fill={data.stroke}
          stroke={halo}
          strokeWidth={style.labelHalo}
          strokeLinejoin="round"
          paintOrder="stroke"
        >
          {drawingMeasurement(data, aspect, sharedScale, displayUnit)}
        </text>
      )}
      {points.map((point, index) => (
        <g key={index} opacity={0.6} data-saved-measure-node={index}>
          <DrawingMeasureNode
            compact
            x={point.x}
            y={point.y}
            arm={style.arm}
            stroke={style.stroke}
            color={data.stroke}
            halo={halo}
          />
        </g>
      ))}
    </g>
  );
}
