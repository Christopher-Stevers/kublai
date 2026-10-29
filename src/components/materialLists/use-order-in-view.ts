"use client";
import { useEffect, useState, type RefObject } from "react";

/** How far down the list, as a share of its height, a heading must scroll
 * up past before its section counts as the one being looked at. */
const LINE = 0.3;

/** The part of the screen the element can show in once every scrolling box
 * around it, up to the root, has clipped it; and whether all of them are
 * scrolled to the end. */
function clipOf(element: Element, root: Element) {
  let top = 0;
  let bottom = window.innerHeight;
  let atEnd = true;
  let scrolled = false;
  for (let box = element.parentElement; box; box = box.parentElement) {
    if (box === root || getComputedStyle(box).overflowY !== "visible") {
      const rect = box.getBoundingClientRect();
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
      if (box.scrollTop > 0) scrolled = true;
      if (box.scrollTop + box.clientHeight < box.scrollHeight - 2)
        atEnd = false;
    }
    if (box === root) break;
  }
  return { top, bottom, atEnd: atEnd && scrolled };
}

/** The order whose section is being looked at, from the headings marked with
 * `data-section-heading` (holding the order id, or nothing) inside the root.
 * A section takes over once its heading's divider scrolls up past a line
 * near the top of the list, or comes into view at the end of the list. */
export function useOrderInView(
  root: RefObject<HTMLElement | null>,
  key: string,
  enabled = true,
  attribute = "data-section-heading",
) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const box = root.current;
    if (!box || !enabled) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      let next = "";
      for (const heading of box.querySelectorAll<HTMLElement>(
        `[${attribute}]`,
      )) {
        const clip = clipOf(heading, box);
        const line = clip.atEnd
          ? clip.bottom
          : clip.top + (clip.bottom - clip.top) * LINE;
        if (heading.getBoundingClientRect().top <= line)
          next = heading.getAttribute(attribute) ?? "";
      }
      setActive(next || null);
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
  }, [root, key, enabled, attribute]);
  return enabled ? active : null;
}
