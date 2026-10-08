import { useId } from "react";
import type { DrawingMarkup } from "~/lib/drawing-workspace";
import {
  drawingLinePath,
  drawingMarkupEdges,
  drawingMeasurement,
  drawingBounds,
} from "~/lib/drawing-annotation-geometry";
import {
  formatLengthAs,
  realLength,
  type SheetScale,
} from "~/lib/sheet-measure";
import { measureColorHalo } from "~/lib/sheet-measure-color";
import { sheetMeasureStyle } from "~/lib/sheet-measure-style";

/** Completed Measure runs keep the same screen-sized marks as the active tool. */
export function DrawingMeasureRunSvg({
  data,
  aspect,
  sharedScale,
  screenPixelSize,
  sheetPixelSize,
}: {
  data: DrawingMarkup;
  aspect: number;
  sharedScale?: SheetScale | null;
  screenPixelSize: number;
  sheetPixelSize?: number;
}) {
  const id = `saved-measure-${useId().replace(/:/g, "")}`;
  const style = sheetMeasureStyle(
    screenPixelSize,
    sheetPixelSize ?? screenPixelSize,
  );
  const halo = measureColorHalo(data.stroke);
  const points = data.points.map((point) => ({
    x: point.x * 1000,
    y: point.y * 1000 * aspect,
  }));
  const edges = drawingMarkupEdges(data);
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
      <defs>
        <radialGradient id={`${id}-fade`}>
          <stop offset="0.45" stopColor="#000000" />
          <stop offset="1" stopColor="#ffffff" />
        </radialGradient>
        <mask
          id={`${id}-ends`}
          maskUnits="userSpaceOnUse"
          x={-1000}
          y={-1000 * aspect}
          width={3000}
          height={3000 * aspect}
        >
          <rect
            x={-1000}
            y={-1000 * aspect}
            width={3000}
            height={3000 * aspect}
            fill="#ffffff"
          />
          {points.map((point, index) => (
            <circle
              key={index}
              cx={point.x}
              cy={point.y}
              r={style.arm * 1.8}
              fill={`url(#${id}-fade)`}
            />
          ))}
        </mask>
      </defs>
      <g mask={`url(#${id}-ends)`}>
        <path
          d={drawingLinePath(data, aspect)}
          fill="none"
          stroke={halo}
          strokeOpacity={0.85}
          strokeWidth={style.stroke * 2.2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          data-saved-measure-path="true"
          d={drawingLinePath(data, aspect)}
          fill="none"
          stroke={data.stroke}
          strokeWidth={style.stroke}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </g>
      {edges.map(({ from, to }) => {
        const a = points[from]!,
          b = points[to]!;
        let rotation = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        if (rotation > 90) rotation -= 180;
        if (rotation < -90) rotation += 180;
        const length =
          scale && storedUnit
            ? storedUnit === "cm"
              ? `${(realLength([data.points[from]!, data.points[to]!], aspect, scale) * 100).toFixed(2)} cm`
              : formatLengthAs(
                  realLength(
                    [data.points[from]!, data.points[to]!],
                    aspect,
                    scale,
                  ),
                  baseUnit,
                  storedUnit,
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
      {edges.length > 1 && (
        <text
          data-saved-measure-total="true"
          x={(drawingBounds(points).left + drawingBounds(points).right) / 2}
          y={drawingBounds(points).top + style.labelOffset}
          textAnchor="middle"
          fontSize={style.font}
          fontWeight={style.fontWeight}
          fill={data.stroke}
          stroke={halo}
          strokeWidth={style.labelHalo}
          strokeLinejoin="round"
          paintOrder="stroke"
        >
          {drawingMeasurement(data, aspect, sharedScale)}
        </text>
      )}
      {points.map((point, index) => (
        <g key={index} opacity={0.6} data-saved-measure-node={index}>
          {[-1, 1].map((direction) => (
            <g key={direction}>
              <line
                x1={point.x - style.arm}
                y1={point.y - direction * style.arm}
                x2={point.x + style.arm}
                y2={point.y + direction * style.arm}
                stroke={halo}
                strokeOpacity={0.85}
                strokeWidth={style.stroke * 2.2}
                strokeLinecap="round"
              />
              <line
                x1={point.x - style.arm}
                y1={point.y - direction * style.arm}
                x2={point.x + style.arm}
                y2={point.y + direction * style.arm}
                stroke={data.stroke}
                strokeWidth={style.stroke}
                strokeLinecap="round"
              />
            </g>
          ))}
        </g>
      ))}
    </g>
  );
}
