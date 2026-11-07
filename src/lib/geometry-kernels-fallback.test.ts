// @vitest-environment node
import { expect, it, vi } from "vitest";
import {
  initializeGeometryKernels,
  compactGeometryRust,
  mergeLinesRust,
} from "./geometry-kernels";
it("keeps TypeScript available when Wasm cannot load", async () => {
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("offline"));
  try {
    expect(await initializeGeometryKernels()).toBe(false);
    expect(
      mergeLinesRust(
        Array.from({ length: 1000 }, () => ({ x1: 0, y1: 0, x2: 1, y2: 0 })),
        1,
      ),
    ).toBeNull();
    expect(
      compactGeometryRust(new Float32Array(6000), new Uint32Array(3000)),
    ).toBeNull();
  } finally {
    fetcher.mockRestore();
  }
});
