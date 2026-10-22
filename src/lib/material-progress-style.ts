/** Hard colour boundary so the coloured area represents the actual percentage. */
export function materialProgressStyle(percent: number) {
  const value = Number.isFinite(percent)
    ? Math.min(100, Math.max(0, percent))
    : 0;
  return {
    background: `linear-gradient(to right, rgb(16 185 129 / 0.25) 0%, rgb(16 185 129 / 0.25) ${value}%, rgb(249 115 22 / 0.25) ${value}%, rgb(249 115 22 / 0.25) 100%)`,
  };
}
