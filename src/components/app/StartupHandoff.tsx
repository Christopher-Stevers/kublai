"use client";
import { useEffect, useRef, useState } from "react";

/** Keep the first HTML frame painted until real route content is ready. */
export function StartupHandoff({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<"loading" | "fading" | "done">("loading");
  const coverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const cover = coverRef.current;
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
          setPhase("fading");
          const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          removal = setTimeout(() => setPhase("done"), reduced ? 0 : 220);
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
  // React owns this subtree, including its removal. Do not remove the DOM node
  // manually: streamed routes may still use it as an insertion anchor.
  if (phase === "done") return null;
  return <div ref={coverRef} id="app-startup-cover" aria-hidden="true" style={{position:"fixed",inset:0,zIndex:10000,background:"#111827",opacity:phase === "loading" ? 1 : 0,pointerEvents:phase === "loading" ? "auto" : "none",transition:"opacity 200ms ease-out"}}>{children}</div>;
}
