export type WheelHand = "left" | "right";
const KEY = "foremanhq:quick-wheel-hand:v1";

/** Learn from deliberate starts at either side; centre touches keep the preference. */
export function learnWheelHand(
  x: number,
  left: number,
  width: number,
): WheelHand {
  let score = 0;
  try {
    const stored = Number(localStorage.getItem(KEY));
    if (Number.isFinite(stored)) score = Math.max(-4, Math.min(4, stored));
  } catch {
    /* Storage is optional. */
  }
  const position = (x - left) / Math.max(1, width);
  const evidence = position < 0.4 ? -1 : position > 0.6 ? 1 : 0;
  if (evidence) {
    score = score * 0.65 + evidence;
    try {
      localStorage.setItem(KEY, String(score));
    } catch {
      /* Private browsing. */
    }
  }
  return score === 0
    ? position < 0.5
      ? "left"
      : "right"
    : score < 0
      ? "left"
      : "right";
}

/** Distance from a label centre to the thumb extending toward the lower hand side. */
export function thumbClearance(
  x: number,
  y: number,
  originX: number,
  originY: number,
  hand: WheelHand,
) {
  const dx = x - originX,
    dy = y - originY;
  const side = hand === "right" ? 1 : -1;
  const outward = dx * side;
  // Cover the area between a straight-down thumb and an angled thumb.
  if (dy >= 0 && outward >= 0 && outward <= dy * 0.75) return 0;
  const along = Math.max(0, outward * 0.6 + dy * 0.8);
  const angled = Math.hypot(outward - along * 0.6, dy - along * 0.8);
  const vertical = Math.hypot(dx, Math.min(0, dy));
  return Math.min(angled, vertical);
}
