"use client";

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const useClientLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
const SLOT = "[data-landscape-navigation-slot]";

/** A phone keyboard can make a portrait viewport wider than it is tall.
 * Prefer physical orientation on touch devices. Desktop keeps the portrait
 * navigation layout even when its window is wider than it is tall. */
export function deviceIsLandscape() {
  if (typeof window.matchMedia !== "function") return false;
  if (window.matchMedia("(pointer: coarse)").matches) {
    const angle = (window as Window & { orientation?: number }).orientation;
    if (typeof angle === "number") return Math.abs(angle) === 90;
    const type = window.screen.orientation?.type;
    if (type) return type.startsWith("landscape");
    if (window.screen.width && window.screen.height)
      return window.screen.width > window.screen.height;
    return window.matchMedia("(orientation: landscape)").matches;
  }
  return false;
}

export function useLandscapeLayout() {
  const [landscape, setLandscape] = useState(false);
  useClientLayoutEffect(() => {
    const media = window.matchMedia?.("(orientation: landscape)");
    const update = () => {
      const next = deviceIsLandscape();
      document.documentElement.toggleAttribute("data-app-landscape", next);
      setLandscape(next);
    };
    update();
    media?.addEventListener?.("change", update);
    window.screen.orientation?.addEventListener?.("change", update);
    window.addEventListener("orientationchange", update);
    window.addEventListener("resize", update);
    return () => {
      media?.removeEventListener?.("change", update);
      window.screen.orientation?.removeEventListener?.("change", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener("resize", update);
      document.documentElement.removeAttribute("data-app-landscape");
    };
  }, []);
  return landscape;
}

/** Only one visible bar receives navigation, even when an inactive footer is
 * kept mounted for animation. Full-screen/modal bars take precedence. */
export function findLandscapeNavigationSlot() {
  const scope = document.fullscreenElement ?? document;
  const slots = Array.from(scope.querySelectorAll<HTMLElement>(SLOT));
  return (
    slots
      .filter((slot) => {
        if (slot.closest('[hidden], [inert], [aria-hidden="true"]'))
          return false;
        const rect = slot.parentElement!.getBoundingClientRect();
        return (
          rect.height > 0 &&
          rect.width > 0 &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight
        );
      })
      .at(-1) ?? null
  );
}

export function LandscapeNavigation({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [fullscreen, setFullscreen] = useState<Element | null>(null);
  useClientLayoutEffect(() => {
    if (!active) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = findLandscapeNavigationSlot();
      setTarget(next);
      setFullscreen(document.fullscreenElement);
      document.documentElement.toggleAttribute(
        "data-landscape-fallback",
        !next,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new MutationObserver((records) => {
      // Ignore drawing/canvas updates and our own portal. Only structural
      // changes involving a slot, or visibility of one of its ancestors,
      // require choosing a different bar.
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
        )
      )
        schedule();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "inert", "aria-hidden", "class", "style"],
    });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    document.addEventListener("fullscreenchange", schedule);
    update();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
      document.removeEventListener("fullscreenchange", schedule);
      document.documentElement.removeAttribute("data-landscape-fallback");
    };
  }, [active]);
  if (!active) return null;
  const navigation = (
    <nav aria-label="Landscape navigation" data-landscape-navigation>
      {children}
    </nav>
  );
  return createPortal(
    target ? (
      navigation
    ) : (
      <div data-landscape-fallback-bar className="pin-viewport-bottom">
        {navigation}
      </div>
    ),
    target ?? fullscreen ?? document.body,
  );
}
