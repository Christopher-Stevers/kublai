/** Four filled arms taper to the exact node coordinate, including their halos. */
export function DrawingMeasureNode({ x, y, arm, stroke, color, halo }: {
  x: number; y: number; arm: number; stroke: number; color: string; halo: string;
}) {
  return <g data-measure-cross="tapered">
    {[-1, 1].flatMap(dx => [-1, 1].map(dy => {
      const endX = x + dx * arm, endY = y + dy * arm;
      const triangle = (width: number) => {
        const offset = width / Math.SQRT2 / 2;
        return `${x},${y} ${endX - dy * offset},${endY + dx * offset} ${endX + dy * offset},${endY - dx * offset}`;
      };
      return <g key={`${dx},${dy}`}>
        <polygon points={triangle(stroke * 2.2)} fill={halo} fillOpacity={0.85} />
        <polygon points={triangle(stroke)} fill={color} />
      </g>;
    }))}
  </g>;
}
