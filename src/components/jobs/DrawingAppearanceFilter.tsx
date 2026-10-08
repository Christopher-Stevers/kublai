/** Treat coloured CAD strokes as ink too; white paper stays separate. */
export function DrawingAppearanceFilter({
  id,
  matrix,
}: {
  id: string;
  matrix: string;
}) {
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute size-0">
      <defs>
        <filter id={id} colorInterpolationFilters="sRGB">
          <feColorMatrix
            in="SourceGraphic"
            type="matrix"
            values="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 1"
            result="red"
          />
          <feColorMatrix
            in="SourceGraphic"
            type="matrix"
            values="0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 1"
            result="green"
          />
          <feColorMatrix
            in="SourceGraphic"
            type="matrix"
            values="0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 1"
            result="blue"
          />
          <feBlend in="red" in2="green" mode="darken" result="redGreen" />
          <feBlend in="redGreen" in2="blue" mode="darken" result="paper" />
          <feColorMatrix
            in="paper"
            type="matrix"
            values={matrix}
            result="coloured"
          />
          <feComposite in="coloured" in2="SourceGraphic" operator="in" />
        </filter>
      </defs>
    </svg>
  );
}
