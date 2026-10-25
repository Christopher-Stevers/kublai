const REST = {
  orange: "rgb(249 115 22 / 0.12)",
  blue: "rgb(37 99 235 / 0.3)",
} as const;
const DONE = "rgb(22 163 74 / 0.35)";

/** Hard colour boundary so the coloured area represents the actual percentage.
 * With `caps` (a CSS length, the pill's end radius) the fill runs over the
 * straight middle only, so both rounded ends keep the rest colour (a done
 * item passes no caps and turns fully green). */
export function materialProgressStyle(
  percent: number,
  rest: keyof typeof REST = "orange",
  caps?: string,
) {
  const value = Number.isFinite(percent)
    ? Math.min(100, Math.max(0, percent))
    : 0;
  if (caps) {
    const end = `calc(${caps} + (100% - 2 * ${caps}) * ${value / 100})`;
    return {
      background: `linear-gradient(to right, ${REST[rest]} 0%, ${REST[rest]} ${caps}, ${DONE} ${caps}, ${DONE} ${end}, ${REST[rest]} ${end}, ${REST[rest]} 100%)`,
    };
  }
  return {
    background: `linear-gradient(to right, ${DONE} 0%, ${DONE} ${value}%, ${REST[rest]} ${value}%, ${REST[rest]} 100%)`,
  };
}
