import { PipeComponentSymbol } from "./PipeComponentSymbol";
import { componentMarker } from "~/lib/pipe-component-marker";
import type { DrawingMarkup } from "~/lib/drawing-workspace";
import type { LengthUnit, SheetScale } from "~/lib/sheet-measure";
import { DrawingMeasureRunSvg } from "./DrawingMeasureRunSvg";
import {
  layoutDrawingText,
  drawingBounds,
  drawingCloudPath,
  drawingFontSize,
  drawingMeasurement,
  drawingLinePath,
  drawingMarkupEdges,
} from "~/lib/drawing-annotation-geometry";

/** Pure SVG primitives shared by the live editor and printable/exported markups.
 * Place inside viewBox="0 0 1000 {1000 * aspect}". Coordinates never use pixels
 * from a particular phone, zoom level or PDF rendering resolution.
 */
export function DrawingAnnotationSvg({
  data,
  aspect,
  sharedScale,
  displayUnit,
  screenPixelSize,
  sheetPixelSize,
}: {
  data: DrawingMarkup;
  aspect: number;
  sharedScale?: SheetScale | null;
  displayUnit?: LengthUnit;
  screenPixelSize?: number;
  sheetPixelSize?: number;
}) {
  if (!data.points.length || !(aspect > 0)) return null;
  if (data.type === "dimension" && data.parents && screenPixelSize) {
    return (
      <DrawingMeasureRunSvg
        data={data}
        aspect={aspect}
        sharedScale={sharedScale}
        displayUnit={displayUnit}
        screenPixelSize={screenPixelSize}
        sheetPixelSize={sheetPixelSize}
      />
    );
  }
  const points = data.points.map((point) => ({
    x: point.x * 1000,
    y: point.y * 1000 * aspect,
  }));
  const first = points[0]!,
    last = points.at(-1)!;
  const bounds = drawingBounds(points);
  const linkHighlight =
    data.type === "link" && data.linkAppearance === "highlight";
  const common = {
    stroke: data.stroke,
    strokeWidth: data.width,
    fill: data.fill ?? "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const fontSize = drawingFontSize(data);
  const label = (text: string, x: number, y: number) => (
    <text
      x={x}
      y={y}
      fontSize={fontSize}
      fill={data.stroke}
      stroke="#ffffff"
      strokeWidth={3}
      paintOrder="stroke"
      strokeLinejoin="round"
    >
      {text.split("\n").map((line, index) => (
        <tspan key={index} x={x} dy={index ? fontSize * 1.25 : 0}>
          {line}
        </tspan>
      ))}
    </text>
  );
  const arrow = (at: typeof first, from: typeof first) => {
    const angle = Math.atan2(at.y - from.y, at.x - from.x),
      size = Math.max(12, data.width * 4);
    return (
      <path
        d={`M ${at.x - Math.cos(angle - 0.5) * size} ${at.y - Math.sin(angle - 0.5) * size} L ${at.x} ${at.y} L ${at.x - Math.cos(angle + 0.5) * size} ${at.y - Math.sin(angle + 0.5) * size}`}
        {...common}
        fill="none"
      />
    );
  };
  let geometry;
  switch (data.type) {
    case "dimension":
      geometry = data.parents ? (
        <path d={drawingLinePath(data, aspect)} {...common} fill="none" />
      ) : (
        <polyline points={line} {...common} fill="none" />
      );
      break;
    case "rect":
    case "link":
      geometry = (
        <rect
          x={bounds.left}
          y={bounds.top}
          width={bounds.right - bounds.left}
          height={bounds.bottom - bounds.top}
          {...common}
          strokeDasharray={
            data.type === "link" && !linkHighlight && !linkHighlight
              ? "8 5"
              : undefined
          }
          {...(linkHighlight
            ? {
                stroke: "none",
                fill:
                  data.fill && data.fill !== "none"
                    ? data.fill
                    : data.stroke === "none"
                      ? "#facc15"
                      : data.stroke,
              }
            : {})}
        />
      );
      break;
    case "ellipse":
      geometry = (
        <ellipse
          cx={(bounds.left + bounds.right) / 2}
          cy={(bounds.top + bounds.bottom) / 2}
          rx={(bounds.right - bounds.left) / 2}
          ry={(bounds.bottom - bounds.top) / 2}
          {...common}
        />
      );
      break;
    case "cloud": {
      const rectangle = drawingBounds(data.points);
      geometry = (
        <path
          d={drawingCloudPath(
            [
              { x: rectangle.left, y: rectangle.top },
              { x: rectangle.right, y: rectangle.top },
              { x: rectangle.right, y: rectangle.bottom },
              { x: rectangle.left, y: rectangle.bottom },
            ],
            aspect,
          )}
          {...common}
        />
      );
      break;
    }
    case "polycloud":
      geometry = <path d={drawingCloudPath(data.points, aspect)} {...common} />;
      break;
    case "area":
      geometry = (
        <polygon
          points={line}
          {...common}
          fill={data.fill ?? `${data.stroke.slice(0, 7)}22`}
        />
      );
      break;
    case "text": {
      // Wrapped to its box (and shrunk to fit) exactly as it was typed.
      const layout = layoutDrawingText(data);
      geometry = (
        <text
          x={first.x}
          y={first.y}
          fontSize={layout.fontSize}
          fill={data.stroke}
          stroke="#ffffff"
          strokeWidth={3}
          paintOrder="stroke"
          strokeLinejoin="round"
        >
          {layout.lines.map((line, index) => (
            <tspan
              key={index}
              x={first.x}
              dy={index ? layout.fontSize * 1.25 : 0}
            >
              {line}
            </tspan>
          ))}
        </text>
      );
      break;
    }
    case "count":
      if (data.pipeComponent) {
        geometry = <PipeComponentSymbol marker={componentMarker(data.pipeComponent)} span={Math.max(componentMarker(data.pipeComponent).span*1000,14*(screenPixelSize??0))} x={first.x} y={first.y} color={data.stroke} name={data.pipeComponent.name} />;
        break;
      }
      geometry = (
        <>
          {points.map((point, index) => (
            <g key={index}>
              <circle
                cx={point.x}
                cy={point.y}
                r={12 + data.width}
                {...common}
                fill="#ffffff"
              />
              <text
                x={point.x}
                y={point.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={15}
                fill={data.stroke}
              >
                {index + 1}
              </text>
            </g>
          ))}
        </>
      );
      break;
    default:
      geometry = (
        <polyline
          points={line}
          {...common}
          fill="none"
          strokeWidth={
            data.type === "highlight"
              ? Math.max(12, data.width * 5)
              : data.width
          }
        />
      );
  }
  const measurement = drawingMeasurement(data, aspect, sharedScale, displayUnit);
  return (
    <g
      opacity={
        data.opacity ?? (data.type === "highlight" || linkHighlight ? 0.35 : 1)
      }
    >
      {geometry}
      {(data.type === "arrow" ||
        (data.type === "dimension" && !data.parents)) &&
        arrow(last, first)}
      {(data.type === "callout" ||
        (data.type === "dimension" && !data.parents)) &&
        arrow(first, last)}
      {data.type === "callout" &&
        label(data.text ?? "Note", last.x + 8, last.y - 8)}
      {data.type === "link" &&
        !linkHighlight &&
        label(
          data.text ?? (data.targetSheetId ? "Sheet link" : "Link"),
          bounds.left + 5,
          bounds.top + fontSize,
        )}
      {data.type === "dimension" &&
        data.parents &&
        drawingMarkupEdges(data).map(({ from, to }) => {
          const a = points[from]!,
            b = points[to]!;
          let rotation = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
          if (rotation > 90) rotation -= 180;
          if (rotation < -90) rotation += 180;
          const segmentLabel = drawingMeasurement(
            {
              ...data,
              parents: undefined,
              points: [data.points[from]!, data.points[to]!],
            },
            aspect,
            sharedScale,
            displayUnit,
          );
          return (
            <g
              key={to}
              transform={`translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2}) rotate(${rotation})`}
              data-measurement-segment={to}
            >
              {label(segmentLabel ?? "Set scale", 0, -8)}
            </g>
          );
        })}
      {measurement &&
        (!data.parents || drawingMarkupEdges(data).length > 1) &&
        label(measurement, (bounds.left + bounds.right) / 2, bounds.top - 8)}
    </g>
  );
}
