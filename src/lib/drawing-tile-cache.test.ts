import { describe, expect, it, vi } from "vitest";
import { DrawingTileCache } from "./drawing-tile-cache";
import type { DrawingTileRequest } from "./drawing-tiles";

function tile(col: number, factor = 4): DrawingTileRequest {
  return {
    key: `${factor}/${col}_0`, url: `/tiles/${factor}/${col}_0.webp`,
    factor, col, row: 0, width: 512, height: 512,
    levelWidth: 8192, levelHeight: 4096, tileSize: 512, visible: true,
  };
}

function harness(budget = 32 * 1024 * 1024) {
  const container = document.createElement("div");
  const images: HTMLImageElement[] = [];
  const makeImage = () => {
    const image = document.createElement("img");
    image.decode = vi.fn(async () => undefined);
    images.push(image);
    return image;
  };
  const cache = new DrawingTileCache(container, budget, makeImage);
  const finish = async (image: HTMLImageElement) => {
    image.dispatchEvent(new Event("load"));
    await Promise.resolve();
  };
  return { container, images, cache, finish };
}

describe("drawing tile surfaces", () => {
  it("limits simultaneous downloads and displays decoded tiles without a fade", async () => {
    const { cache, container, images, finish } = harness();
    cache.update(Array.from({ length: 12 }, (_, col) => tile(col)));
    expect(images).toHaveLength(4);
    expect(container.children).toHaveLength(0);
    await finish(images[0]!);
    expect(container.children).toHaveLength(1);
    expect(images).toHaveLength(5);
    expect(images[0]!.style.opacity).toBe("");
    expect(images[0]!.style.transition).toBe("");
    cache.dispose();
  });

  it("keeps the same decoded node when panning away and back", async () => {
    const { cache, container, images, finish } = harness();
    cache.update([tile(0)]);
    await finish(images[0]!);
    cache.update([tile(1)]);
    await finish(images[1]!);
    cache.update([tile(0)]);
    expect(images).toHaveLength(2);
    expect(container.firstChild).toBe(images[0]);
    expect(images[0]!.src).toContain("/tiles/4/0_0.webp");
    cache.dispose();
  });

  it("retains the lower level while the new level is decoding", async () => {
    const { cache, container, images, finish } = harness();
    cache.update([tile(0, 2)]);
    await finish(images[0]!);
    cache.update([tile(0), tile(0, 2)]);
    expect(container.children).toHaveLength(1);
    expect(container.firstChild).toBe(images[0]);
    await finish(images[1]!);
    expect(container.children).toHaveLength(2);
    expect(images[0]!.style.zIndex).toBe("2");
    expect(images[1]!.style.zIndex).toBe("4");
    cache.dispose();
  });

  it("accounts for in-flight images and evicts old decoded surfaces within its byte budget", async () => {
    const { cache, container, images, finish } = harness(2 * 512 * 512 * 4);
    cache.update([tile(0), tile(1), tile(2)]);
    expect(images).toHaveLength(2);
    cache.update([tile(2), tile(3)]);
    expect(images).toHaveLength(2); // in-flight images still count
    await finish(images[0]!);
    expect(images).toHaveLength(3);
    expect(images[0]!.hasAttribute("src")).toBe(false);
    await finish(images[1]!);
    expect(images).toHaveLength(4);
    await finish(images[2]!);
    await finish(images[3]!);
    expect(container.children).toHaveLength(2);
    expect([...container.children].map((image) => (image as HTMLElement).dataset.drawingTile))
      .toEqual(["4/2_0", "4/3_0"]);
    cache.dispose();
  });

  it("does not retry a broken tile every frame and releases pending work on unmount", async () => {
    const { cache, container, images, finish } = harness();
    cache.update([tile(0)]);
    images[0]!.dispatchEvent(new Event("error"));
    for (let i = 0; i < 20; i++) cache.update([tile(0)]);
    expect(images).toHaveLength(1);
    cache.update([tile(1)]);
    cache.dispose();
    await finish(images[1]!);
    expect(container.children).toHaveLength(0);
    expect(images[1]!.hasAttribute("src")).toBe(false);
    cache.update([tile(2)]);
    expect(images).toHaveLength(2);
  });

  it("recovers from a transient tile failure after a bounded cooldown", async () => {
    vi.useFakeTimers();
    const { cache, container, images, finish } = harness();
    try {
      cache.update([tile(0)]);
      images[0]!.dispatchEvent(new Event("error"));
      await vi.advanceTimersByTimeAsync(2_999);
      expect(images).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(images).toHaveLength(2);
      expect(images[1]!.src).toBe(images[0]!.src);
      await finish(images[1]!);
      expect(container.firstChild).toBe(images[1]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(images).toHaveLength(2);
    } finally {
      cache.dispose();
      vi.useRealTimers();
    }
  });
});
