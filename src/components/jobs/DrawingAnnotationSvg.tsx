import type { DrawingMarkup } from "~/lib/drawing-workspace";
import type { SheetScale } from "~/lib/sheet-measure";
import { drawingBounds, drawingCloudPath, drawingMeasurement } from "~/lib/drawing-annotation-geometry";

/** Pure SVG primitives shared by the live editor and printable/exported markups.
 * Place inside viewBox="0 0 1000 {1000 * aspect}". Coordinates never use pixels
 * from a particular phone, zoom level or PDF rendering resolution.
 */
export function DrawingAnnotationSvg({ data, aspect, sharedScale }: {
  data: DrawingMarkup; aspect: number; sharedScale?: SheetScale | null;
}) {
  if (!data.points.length || !(aspect > 0)) return null;
  const points = data.points.map(point => ({ x: point.x * 1000, y: point.y * 1000 * aspect }));
  const first = points[0]!, last = points.at(-1)!;
  const bounds = drawingBounds(points);
  const common = { stroke: data.stroke, strokeWidth: data.width, fill: data.fill ?? "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const line = points.map(point => `${point.x},${point.y}`).join(" ");
  const fontSize = Math.max(18, 14 + data.width * 2);
  const label = (text: string, x: number, y: number) => <text x={x} y={y} fontSize={fontSize} fill={data.stroke} stroke="#ffffff" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">{text}</text>;
  const arrow = (at: typeof first, from: typeof first) => {
    const angle = Math.atan2(at.y - from.y, at.x - from.x), size = Math.max(12, data.width * 4);
    return <path d={`M ${at.x - Math.cos(angle - 0.5) * size} ${at.y - Math.sin(angle - 0.5) * size} L ${at.x} ${at.y} L ${at.x - Math.cos(angle + 0.5) * size} ${at.y - Math.sin(angle + 0.5) * size}`} {...common} fill="none" />;
  };
  let geometry;
  switch (data.type) {
    case "rect": case "link":
      geometry = <rect x={bounds.left} y={bounds.top} width={bounds.right - bounds.left} height={bounds.bottom - bounds.top} {...common} strokeDasharray={data.type === "link" ? "8 5" : undefined} />;
      break;
    case "ellipse":
      geometry = <ellipse cx={(bounds.left + bounds.right) / 2} cy={(bounds.top + bounds.bottom) / 2} rx={(bounds.right - bounds.left) / 2} ry={(bounds.bottom - bounds.top) / 2} {...common} />;
      break;
    case "cloud": {
      const rectangle = drawingBounds(data.points);
      geometry = <path d={drawingCloudPath([{ x: rectangle.left, y: rectangle.top }, { x: rectangle.right, y: rectangle.top }, { x: rectangle.right, y: rectangle.bottom }, { x: rectangle.left, y: rectangle.bottom }], aspect)} {...common} />;
      break;
    }
    case "polycloud": geometry = <path d={drawingCloudPath(data.points, aspect)} {...common} />; break;
    case "area": geometry = <polygon points={line} {...common} fill={data.fill ?? `${data.stroke.slice(0, 7)}22`} />; break;
    case "text": geometry = label(data.text ?? "Text", first.x, first.y); break;
    case "count": geometry = <>{points.map((point, index) => <g key={index}><circle cx={point.x} cy={point.y} r={12 + data.width} {...common} fill="#ffffff" /><text x={point.x} y={point.y} textAnchor="middle" dominantBaseline="central" fontSize={15} fill={data.stroke}>{index + 1}</text></g>)}</>; break;
    default: geometry = <polyline points={line} {...common} fill="none" strokeWidth={data.type === "highlight" ? Math.max(12, data.width * 5) : data.width} />;
  }
  const measurement = drawingMeasurement(data, aspect, sharedScale);
  return <g opacity={data.opacity ?? (data.type === "highlight" ? 0.35 : 1)}>
    {geometry}
    {(data.type === "arrow" || data.type === "dimension") && arrow(last, first)}
    {(data.type === "callout" || data.type === "dimension") && arrow(first, last)}
    {data.type === "callout" && label(data.text ?? "Note", last.x + 8, last.y - 8)}
    {data.type === "link" && label(data.text ?? (data.targetSheetId ? "Sheet link" : "Link"), bounds.left + 5, bounds.top + fontSize)}
    {measurement && label(measurement, (bounds.left + bounds.right) / 2, bounds.top - 8)}
  </g>;
}
