export type WheelBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
type Box = { x: number; y: number; width: number; height: number };
export type WheelLayout =
  | { kind: "circle" }
  | { kind: "fan"; panel: Box; choices: Box[] };
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

/** Keep the finger as the origin; unfold the choices into the available space. */
export function quickWheelLayout(
  x: number,
  y: number,
  radius: number,
  count: number,
  bounds: WheelBounds,
): WheelLayout {
  if (
    x - radius >= bounds.left &&
    x + radius <= bounds.right &&
    y - radius >= bounds.top &&
    y + radius <= bounds.bottom
  )
    return { kind: "circle" };
  const width = Math.min(344, bounds.right - bounds.left);
  const availableHeight = bounds.bottom - bounds.top;
  const columns = availableHeight < 290 && width >= 300 ? 4 : 2;
  const rows = Math.ceil(count / columns);
  const gap = 6,
    padding = 10,
    header = 42;
  const tileHeight = Math.min(
    54,
    (availableHeight - header - padding * 2 - gap * (rows - 1)) / rows,
  );
  const height = header + padding * 2 + rows * tileHeight + gap * (rows - 1);
  const candidates = [
    { x: x - width / 2, y: y + 32 },
    { x: x - width / 2, y: y - height - 32 },
    { x: x + 32, y: y - height / 2 },
    { x: x - width - 32, y: y - height / 2 },
  ].map((position) => {
    const placed = {
      x: clamp(position.x, bounds.left, bounds.right - width),
      y: clamp(position.y, bounds.top, bounds.bottom - height),
      width,
      height,
    };
    const distance = Math.hypot(
      x - clamp(x, placed.x, placed.x + width),
      y - clamp(y, placed.y, placed.y + height),
    );
    return {
      placed,
      score:
        (distance < 24 ? 10000 : 0) +
        Math.hypot(placed.x - position.x, placed.y - position.y),
    };
  });
  candidates.sort((a, b) => a.score - b.score);
  const panel = candidates[0]!.placed;
  const tileWidth = (width - padding * 2 - gap * (columns - 1)) / columns;
  return {
    kind: "fan",
    panel,
    choices: Array.from({ length: count }, (_, index) => ({
      x: panel.x + padding + (index % columns) * (tileWidth + gap),
      y:
        panel.y +
        padding +
        header +
        Math.floor(index / columns) * (tileHeight + gap),
      width: tileWidth,
      height: tileHeight,
    })),
  };
}

export function fanChoiceAt(
  layout: Extract<WheelLayout, { kind: "fan" }>,
  x: number,
  y: number,
  originX: number,
  originY: number,
) {
  if (Math.hypot(x - originX, y - originY) < 24) return null;
  const index = layout.choices.findIndex(
    (box) =>
      x >= box.x &&
      x <= box.x + box.width &&
      y >= box.y &&
      y <= box.y + box.height,
  );
  return index < 0 ? null : index;
}
