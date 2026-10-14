/** Straight crosshair arms leave the target visible through a transparent center. */
export function DrawingMeasureNode({ x, y, arm, stroke, color, halo }: {
  x: number; y: number; arm: number; stroke: number; color: string; halo: string;
}) {
  const gap = arm * 0.35;
  return <g data-measure-cross="open-center">
    {[-1, 1].flatMap(dx => [-1, 1].map(dy => (
      <g key={`${dx},${dy}`}>
        <line x1={x + dx * gap} y1={y + dy * gap} x2={x + dx * arm} y2={y + dy * arm}
          stroke={halo} strokeOpacity={0.85} strokeWidth={stroke * 2.2} strokeLinecap="butt" />
        <line x1={x + dx * gap} y1={y + dy * gap} x2={x + dx * arm} y2={y + dy * arm}
          stroke={color} strokeWidth={stroke} strokeLinecap="butt" />
      </g>
    )))}
  </g>;
}
