/** Hard colour boundary so the coloured area represents the actual percentage. */
export function materialProgressStyle(percent: number) {
  const value = Number.isFinite(percent)
    ? Math.min(100, Math.max(0, percent))
    : 0;
  return {
    background: `linear-gradient(to right, rgb(22 163 74 / 0.35) 0%, rgb(22 163 74 / 0.35) ${value}%, rgb(249 115 22 / 0.12) ${value}%, rgb(249 115 22 / 0.12) 100%)`,
  };
}
