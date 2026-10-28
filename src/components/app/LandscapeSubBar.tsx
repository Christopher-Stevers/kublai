"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const useClientLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
const SLOT = "[data-landscape-subbar-slot]";
const SCOPE = "[data-landscape-scope]";

/** Follows the orientation the app header sets on <html>. */
function useAppLandscape() {
  const [landscape, setLandscape] = useState(false);
  useClientLayoutEffect(() => {
    const html = document.documentElement;
    const update = () => setLandscape(html.hasAttribute("data-app-landscape"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(html, { attributes: true, attributeFilter: ["data-app-landscape"] });
    return () => observer.disconnect();
  }, []);
  return landscape;
}

/** The bottom bar of this screen: inside the same `data-landscape-scope`,
 * not one belonging to a dialog or panel opened within it. */
export function findLandscapeSubBarSlot(anchor: Element) {
  const scope = anchor.closest(SCOPE);
  if (!scope) return null;
  return (
    Array.from(scope.querySelectorAll<HTMLElement>(SLOT))
      .filter(
        (slot) =>
          slot.parentElement?.closest(SCOPE) === scope &&
          !slot.closest('[hidden], [inert], [aria-hidden="true"]'),
      )
      .at(-1) ?? null
  );
}

/**
 * A screen's second top bar (title, steps, filters under the app header).
 * In landscape the app header leaves the top, and this bar joins the
 * screen's bottom bar above its buttons, so the content keeps the height.
 * `className` styles the bar where it normally sits. The screen's root needs
 * `data-landscape-scope`.
 */
export function LandscapeSubBar({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const landscape = useAppLandscape();
  const anchor = useRef<HTMLSpanElement>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useClientLayoutEffect(() => {
    if (!landscape) {
      setTarget(null);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      setTarget(anchor.current ? findLandscapeSubBarSlot(anchor.current) : null);
    };
    // Bars mount after loading and hide behind open panels; only changes
    // that add, remove or hide a slot need a new choice.
    const observer = new MutationObserver((records) => {
      if (
        records.some((record) =>
          record.type === "attributes"
            ? record.target instanceof Element &&
              !!record.target.querySelector(SLOT)
            : [...record.addedNodes, ...record.removedNodes].some(
                (node) =>
                  node instanceof Element &&
                  (node.matches(SLOT) || !!node.querySelector(SLOT)),
              ),
        ) &&
        !frame
      )
        frame = requestAnimationFrame(update);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "inert", "aria-hidden"],
    });
    update();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [landscape]);

  return (
    <>
      <span ref={anchor} hidden data-landscape-subbar-anchor />
      {target ? (
        createPortal(<div data-landscape-subbar>{children}</div>, target)
      ) : (
        <div className={className}>{children}</div>
      )}
    </>
  );
}
