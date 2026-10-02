/** Fit a normalized room in the current plan viewport with room to see its walls. */
export function roomReviewTransform(
  box: { x: number; y: number; w: number; h: number },
  plan: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  if (
    ![
      box.x,
      box.y,
      box.w,
      box.h,
      plan.width,
      plan.height,
      viewport.width,
      viewport.height,
    ].every(Number.isFinite) ||
    box.w <= 0 ||
    box.h <= 0 ||
    plan.width <= 0 ||
    plan.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return null;
  const scale = Math.max(
    1,
    Math.min(
      24,
      (viewport.width * 0.75) / (box.w * plan.width),
      (viewport.height * 0.75) / (box.h * plan.height),
    ),
  );
  return {
    scale,
    tx: viewport.width / 2 - (box.x + box.w / 2) * plan.width * scale,
    ty: viewport.height / 2 - (box.y + box.h / 2) * plan.height * scale,
  };
}
