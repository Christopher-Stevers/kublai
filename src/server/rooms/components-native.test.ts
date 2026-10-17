// @vitest-environment node
import { describe, expect, it } from "vitest";
import { freeComponentsNative } from "./components-native";
import { freeComponents } from "./raster-rooms";

describe("Rust free-space labeling", () => {
  it.each([1, 17, 512])(
    "preserves four-connected labels, sizes and exterior flags (%s)",
    async (width) => {
      const height = width + 2;
      for (const mode of [0, 1, 2, 3]) {
        const data = Uint8Array.from({ length: width * height }, (_, i) =>
          mode === 0
            ? 0
            : mode === 1
              ? 1
              : mode === 2
                ? ((i % width) + Math.floor(i / width)) % 2
                : Number(
                    (i % width) % 11 === 0 || Math.floor(i / width) % 13 === 0,
                  ),
        );
        const mask = { width, height, data };
        expect(await freeComponentsNative(mask, "rust")).toEqual(
          freeComponents(mask),
        );
      }
    },
  );
  it("rejects malformed masks", async () => {
    await expect(
      freeComponentsNative(
        { width: 2, height: 2, data: new Uint8Array(3) },
        "rust",
      ),
    ).rejects.toThrow("Invalid");
    await expect(
      freeComponentsNative(
        { width: 1, height: 1, data: new Uint8Array([2]) },
        "rust",
      ),
    ).rejects.toThrow();
  });
});
