/** Sizes in the caller's SVG units. Both active and saved runs use this styling. */
export function sheetMeasureStyle(screenPixel: number, sheetPixel = 1) {
  return {
    stroke: Math.max(0.08 * sheetPixel, 1.1 * screenPixel),
    arm: Math.max(0.6 * sheetPixel, 5 * screenPixel),
    font: 14 * screenPixel,
    fontWeight: 600,
    labelHalo: 4 * screenPixel,
    labelOffset: -8 * screenPixel,
  };
}
