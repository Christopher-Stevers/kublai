"use client";
import { useEffect } from "react";

/** Keep the first HTML frame painted until real route content is ready. */
export function StartupHandoff() {
  useEffect(() => {
    const cover = document.getElementById("app-startup-cover");
    const content = document.getElementById("app-startup-content");
    if (!cover || !content) return;
    let exiting = false;
    let firstFrame = 0;
    let secondFrame = 0;
    let removal: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(check);
    function check() {
      if (exiting || !content || !cover) return;
      const pending = [...content.querySelectorAll("[data-app-startup-loading]")]
        .some(element => element.getClientRects().length > 0);
      const painted = [...content.children].some(element =>
        !["SCRIPT", "STYLE", "LINK", "TEMPLATE"].includes(element.tagName) &&
        element.getClientRects().length > 0,
      );
      if (pending || !painted) return;
      exiting = true;
      observer.disconnect();
      // Give the ready page a paint underneath before fading the cover.
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          cover.style.pointerEvents = "none";
          cover.style.opacity = "0";
          const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          removal = setTimeout(() => cover.remove(), reduced ? 0 : 220);
        });
      });
    }
    observer.observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "style", "class"] });
    check();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      clearTimeout(removal);
    };
  }, []);
  return null;
}
