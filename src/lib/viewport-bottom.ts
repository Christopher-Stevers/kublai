/** iPadOS can leave `position: fixed; bottom: 0` bars anchored to a stale
 * layout viewport (after the keyboard closes, or in the home-screen app while
 * scrolling), so they float above the screen's bottom edge. A zero-height
 * fixed probe shows where "bottom: 0" really lands; the gap to the visible
 * bottom is published as --viewport-bottom for `.pin-viewport-bottom` bars. */
export function bindViewportBottom(root: HTMLElement = document.documentElement) {
  const viewport = window.visualViewport;
  if (!viewport) return () => undefined;
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  Object.assign(probe.style, { position: "fixed", left: "0", bottom: "0", width: "0", height: "0", pointerEvents: "none", visibility: "hidden" });
  document.body.appendChild(probe);
  let frame = 0;
  const update = () => {
    frame = 0;
    // Pinch zoom pans the visual viewport on purpose; leave bars where they are.
    const zoomed = Math.abs(viewport.scale - 1) > 0.01;
    const gap = viewport.offsetTop + viewport.height - probe.getBoundingClientRect().top;
    // Only close a gap: a negative one is the keyboard covering the bar, as usual.
    const offset = !zoomed && gap > 1 ? Math.round(gap) : 0;
    if (offset) root.style.setProperty("--viewport-bottom", `${offset}px`);
    else root.style.removeProperty("--viewport-bottom");
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  update();
  viewport.addEventListener("resize", schedule);
  viewport.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", schedule, { passive: true });
  return () => {
    cancelAnimationFrame(frame);
    viewport.removeEventListener("resize", schedule);
    viewport.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("scroll", schedule);
    probe.remove();
    root.style.removeProperty("--viewport-bottom");
  };
}
