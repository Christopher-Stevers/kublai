/**
 * Map-style tiles for Drawings sheets. Factor 1 is the saved floor-<page>.webp;
 * tiles add sharper levels so zooming always shows ready-made, sharp images.
 */
export const TILE_SIZE = 512;
export const TILE_FACTORS = [2, 4] as const;
export type TileFactor = (typeof TILE_FACTORS)[number];

export type TileManifest = {
  version: 1;
  tileSize: number;
  levels: Array<{ factor: number; width: number; height: number }>;
};

/** `/api/job-rooms/files/<job>/<upload>/floor-<n>.webp` → its tile folder. */
export function tileBase(imageUrl: string) {
  const match =
    /^(\/api\/job-rooms\/files\/[0-9a-f-]{36}\/[0-9a-f-]{36})\/floor-(\d+)\.webp$/i.exec(
      imageUrl,
    );
  return match ? `${match[1]}/tiles/${match[2]}` : null;
}

export function isTileManifest(value: unknown): value is TileManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<TileManifest>;
  return (
    manifest.version === 1 &&
    typeof manifest.tileSize === "number" &&
    Array.isArray(manifest.levels) &&
    manifest.levels.every(
      (level) =>
        typeof level?.factor === "number" &&
        typeof level.width === "number" &&
        typeof level.height === "number",
    )
  );
}

/**
 * The tile level to show: the least-detailed level that still has at least
 * one image pixel per screen pixel. Returns null when the saved image (factor
 * 1) is already sharp enough.
 */
export function pickTileLevel(
  manifest: TileManifest,
  screenPixelsPerBasePixel: number,
) {
  if (screenPixelsPerBasePixel <= 1.05) return null;
  const levels = [...manifest.levels].sort((a, b) => a.factor - b.factor);
  return (
    levels.find((level) => level.factor >= screenPixelsPerBasePixel * 0.95) ??
    levels.at(-1) ??
    null
  );
}

/** Tiles of `level` overlapping the visible part of the sheet (0..1 coords), plus a margin. */
export function visibleTiles(
  level: { width: number; height: number },
  tileSize: number,
  visible: { left: number; top: number; right: number; bottom: number },
  margin = 1,
) {
  const cols = Math.ceil(level.width / tileSize);
  const rows = Math.ceil(level.height / tileSize);
  const clamp = (n: number, max: number) => Math.min(max - 1, Math.max(0, n));
  const c0 = clamp(Math.floor((visible.left * level.width) / tileSize) - margin, cols);
  const c1 = clamp(Math.floor((visible.right * level.width) / tileSize) + margin, cols);
  const r0 = clamp(Math.floor((visible.top * level.height) / tileSize) - margin, rows);
  const r1 = clamp(Math.floor((visible.bottom * level.height) / tileSize) + margin, rows);
  const tiles: Array<{ col: number; row: number }> = [];
  if (visible.right < 0 || visible.left > 1 || visible.bottom < 0 || visible.top > 1)
    return tiles;
  for (let row = r0; row <= r1; row++)
    for (let col = c0; col <= c1; col++) tiles.push({ col, row });
  return tiles;
}
