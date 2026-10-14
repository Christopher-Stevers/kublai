/** Keep the entire chat shell inside Safari's visible area above the keyboard.
 * Resizing only the thread leaves the app header outside the panned viewport. */
export function bindChatViewport(panel: HTMLElement) {
  const shell = panel.closest<HTMLElement>("[data-app-shell]");
  if (!shell) return () => undefined;
  const previousStyle = shell.getAttribute("style");
  const previousPosition = panel.style.position;
  const viewport = window.visualViewport;
  let frame = 0;
  const update = () => {
    frame = 0;
    // Pinch zoom should remain a browser operation, not trigger a layout reflow.
    if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
    Object.assign(shell.style, {
      position: "fixed",
      left: "0",
      right: "0",
      top: `${viewport?.offsetTop ?? 0}px`,
      height: `${viewport?.height ?? window.innerHeight}px`,
      minHeight: "0",
      overflow: "hidden",
    });
    // The chat's existing top inset reserves the app header; bottom:0 keeps
    // the composer above the keyboard. Only its message list can scroll.
    panel.style.position = "absolute";
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  update();
  viewport?.addEventListener("resize", schedule);
  viewport?.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  return () => {
    cancelAnimationFrame(frame);
    viewport?.removeEventListener("resize", schedule);
    viewport?.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    if (previousStyle === null) shell.removeAttribute("style");
    else shell.setAttribute("style", previousStyle);
    panel.style.position = previousPosition;
  };
}
