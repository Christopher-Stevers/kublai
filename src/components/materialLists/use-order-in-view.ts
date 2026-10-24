"use client";
import { useEffect, useState, type RefObject } from "react";

/** How much of an order must show before its receiving bar comes up. */
const SHOW_AT = 60;

/** The height of an element still on screen once every scrolling box
 * around it, up to the root, has clipped it. */
function visibleHeight(element: Element, root: Element) {
  const rect = element.getBoundingClientRect();
  let top = Math.max(rect.top, 0);
  let bottom = Math.min(rect.bottom, window.innerHeight);
  for (let box = element.parentElement; box; box = box.parentElement) {
    if (box === root || getComputedStyle(box).overflowY !== "visible") {
      const clip = box.getBoundingClientRect();
      top = Math.max(top, clip.top);
      bottom = Math.min(bottom, clip.bottom);
    }
    if (box === root) break;
  }
  return Math.max(0, bottom - top);
}

/** The order taking up most of the list on screen, from the elements marked
 * with `data-order-id` inside the root. It stays until it scrolls right off,
 * so the bar it brings up cannot push it away again. */
export function useOrderInView(
  root: RefObject<HTMLElement | null>,
  key: string,
  enabled = true,
) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const box = root.current;
    if (!box || !enabled) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const heights = new Map<string, number>();
      box
        .querySelectorAll<HTMLElement>("[data-order-id]")
        .forEach((element) => {
          const id = element.dataset.orderId;
          if (id)
            heights.set(
              id,
              (heights.get(id) ?? 0) + visibleHeight(element, box),
            );
        });
      setActive((current) => {
        let best: string | null = null;
        let most = 0;
        for (const [id, height] of heights)
          if (height > most) {
            best = id;
            most = height;
          }
        if (best && most >= SHOW_AT) return best;
        return current && (heights.get(current) ?? 0) > 0 ? current : null;
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    document.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", schedule);
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    resize?.observe(box);
    if (box.firstElementChild) resize?.observe(box.firstElementChild);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      resize?.disconnect();
    };
  }, [root, key, enabled]);
  return enabled ? active : null;
}
