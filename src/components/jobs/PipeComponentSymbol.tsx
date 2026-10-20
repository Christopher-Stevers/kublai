import { memo } from "react";
import {
  componentMarkerPath,
  type PipeComponentMarker,
} from "~/lib/pipe-component-marker";

/** Shared by detection previews, saved markups, and SVG snapshots. */
export const PipeComponentSymbol = memo(function PipeComponentSymbol({
  marker,
  x,
  y,
  color,
  span = marker.span * 1000,
  pending = false,
  name,
}: {
  marker: PipeComponentMarker;
  x: number;
  y: number;
  color: string;
  span?: number;
  pending?: boolean;
  name: string;
}) {
  const d = componentMarkerPath(marker, x, y, span);
  const width = Math.max(0.12, span * 0.065);
  return (
    <g
      data-pipe-component-symbol={name}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>
        {name}
        {pending ? " — review required" : ""}
      </title>
      {pending && (
        <circle
          cx={x}
          cy={y}
          r={span * 0.7}
          stroke={color}
          strokeWidth={width * 0.65}
          strokeDasharray={`${width} ${width * 2}`}
          opacity={0.8}
        />
      )}
      <path d={d} stroke="#111827" strokeWidth={width * 2.5} />
      <path d={d} stroke={color} strokeWidth={width} />
      {marker.label && (
        <text
          x={x + span * 0.55}
          y={y - span * 0.45}
          fontSize={span * 0.45}
          fontWeight={700}
          fill={color}
          stroke="#111827"
          strokeWidth={span * 0.065}
          paintOrder="stroke"
          strokeLinejoin="round"
        >
          {marker.label}
        </text>
      )}
    </g>
  );
});
