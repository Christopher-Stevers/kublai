import { describe, expect, it } from "vitest";
import { roomReviewTransform } from "./floor-plan-viewport";

describe("room review viewport", () => {
  it.each([
    { width: 360, height: 640 },
    { width: 900, height: 400 },
  ])(
    "centers an offscreen room and leaves wall context in $width × $height",
    (viewport) => {
      const box = { x: 0.75, y: 0.65, w: 0.15, h: 0.2 };
      const plan = { width: 350, height: 260 };
      const view = roomReviewTransform(box, plan, viewport)!;
      expect(
        (box.x + box.w / 2) * plan.width * view.scale + view.tx,
      ).toBeCloseTo(viewport.width / 2);
      expect(
        (box.y + box.h / 2) * plan.height * view.scale + view.ty,
      ).toBeCloseTo(viewport.height / 2);
      expect(box.w * plan.width * view.scale).toBeLessThanOrEqual(
        viewport.width * 0.75,
      );
      expect(box.h * plan.height * view.scale).toBeLessThanOrEqual(
        viewport.height * 0.75,
      );
    },
  );
  it("bounds zoom for a tiny proposal and ignores an unloaded image", () => {
    expect(
      roomReviewTransform(
        { x: 0.1, y: 0.1, w: 0.00001, h: 0.00001 },
        { width: 350, height: 260 },
        { width: 360, height: 640 },
      )?.scale,
    ).toBe(24);
    expect(
      roomReviewTransform(
        { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
        { width: 0, height: 0 },
        { width: 360, height: 640 },
      ),
    ).toBeNull();
  });
});
