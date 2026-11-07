import { describe, expect, it } from "vitest";
import { isTileManifest, pickTileLevel, planDrawingTiles, tileBase, visibleTiles, type TileManifest } from "./drawing-tiles";

const manifest: TileManifest = {
  version: 1,
  tileSize: 512,
  levels: [
    { factor: 2, width: 4400, height: 3300 },
    { factor: 4, width: 8800, height: 6600 },
  ],
};

describe("drawing tiles", () => {
  it("finds the tile folder for a split drawing image only", () => {
    const job = "0391aed4-7773-47ec-9141-09df373ec008";
    const upload = "d814fc88-da7c-4df5-aa89-fe3c1fde0462";
    expect(tileBase(`/api/job-rooms/files/${job}/${upload}/floor-14.webp`)).toBe(
      `/api/job-rooms/files/${job}/${upload}/tiles/14`,
    );
    expect(tileBase(`/api/job-rooms/files/${job}/floor-1.webp`)).toBeNull();
    expect(tileBase("https://elsewhere.example/floor-1.webp")).toBeNull();
  });

  it("uses the saved image until it is too soft, then the least detailed sharp level", () => {
    expect(pickTileLevel(manifest, 1)).toBeNull();
    expect(pickTileLevel(manifest, 1.6)?.factor).toBe(2);
    expect(pickTileLevel(manifest, 2)?.factor).toBe(2);
    expect(pickTileLevel(manifest, 3)?.factor).toBe(4);
    expect(pickTileLevel(manifest, 9)?.factor).toBe(4); // deepest; the PDF redraw covers the rest
  });

  it("lists only tiles on screen plus a margin, and none when the sheet is off screen", () => {
    const tiles = visibleTiles(manifest.levels[1]!, 512, { left: 0.5, top: 0.5, right: 0.55, bottom: 0.55 });
    const cols = new Set(tiles.map((t) => t.col));
    const rows = new Set(tiles.map((t) => t.row));
    expect([...cols].sort((a, b) => a - b)).toEqual([7, 8, 9, 10]); // visible 8–9, plus one either side
    expect([...rows].sort((a, b) => a - b)).toEqual([5, 6, 7, 8]); // visible 6–7, plus one either side
    expect(visibleTiles(manifest.levels[1]!, 512, { left: 1.2, top: 0, right: 1.5, bottom: 1 })).toEqual([]);
    // Never outside the grid.
    const all = visibleTiles(manifest.levels[0]!, 512, { left: -1, top: -1, right: 2, bottom: 2 });
    expect(Math.max(...all.map((t) => t.col))).toBe(8);
    expect(Math.max(...all.map((t) => t.row))).toBe(6);
  });

  it("validates manifests", () => {
    expect(isTileManifest(manifest)).toBe(true);
    expect(isTileManifest({ version: 2, tileSize: 512, levels: [] })).toBe(false);
    expect(isTileManifest(null)).toBe(false);
    expect(isTileManifest({ ...manifest, tileSize: 0 })).toBe(false);
    expect(isTileManifest({ ...manifest, tileSize: Infinity })).toBe(false);
    expect(isTileManifest({ ...manifest, levels: [] })).toBe(false);
    expect(isTileManifest({ ...manifest, levels: [{ factor: 4, width: -1, height: 300 }] })).toBe(false);
  });

  it("requests sharp visible tiles near the center before fallback or off-screen tiles", () => {
    const requests = planDrawingTiles("/tiles", manifest, 3, { left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 });
    const sharp = requests.filter((tile) => tile.factor === 4 && tile.visible);
    const fallback = requests.filter((tile) => tile.factor === 2 && tile.visible);
    expect(requests.slice(0, sharp.length)).toEqual(sharp);
    expect(requests.slice(sharp.length, sharp.length + fallback.length)).toEqual(fallback);
    expect(requests[0]?.url).toBe("/tiles/4/8_6.webp");
    expect(requests.slice(sharp.length + fallback.length).every((tile) => !tile.visible)).toBe(true);
    expect(planDrawingTiles("/tiles", manifest, 1, { left: 0, top: 0, right: 1, bottom: 1 })).toEqual([]);
  });
});
