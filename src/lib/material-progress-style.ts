const REST = {
  orange: "rgb(249 115 22 / 0.12)",
  blue: "rgb(37 99 235 / 0.3)",
} as const;

/** Hard colour boundary so the coloured area represents the actual percentage. */
export function materialProgressStyle(
  percent: number,
  rest: keyof typeof REST = "orange",
) {
  const value = Number.isFinite(percent)
    ? Math.min(100, Math.max(0, percent))
    : 0;
  return {
    background: `linear-gradient(to right, rgb(22 163 74 / 0.35) 0%, rgb(22 163 74 / 0.35) ${value}%, ${REST[rest]} ${value}%, ${REST[rest]} 100%)`,
  };
}
