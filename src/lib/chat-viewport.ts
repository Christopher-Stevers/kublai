/** Keep the entire chat shell inside Safari's visible area above the keyboard.
 * The workspace owns sizing; embedded threads must just fill it. */
export function bindChatViewport(panel: HTMLElement) {
  const shell = panel.closest<HTMLElement>("[data-app-shell]");
  if (!shell) return () => undefined;
  const previousStyle = shell.getAttribute("style");
  const previousPosition = panel.style.position;
  const viewport = window.visualViewport;
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settleUntil = 0;
  let lastGeometry = "";
  let disposed = false;

  const update = () => {
    if (disposed || document.visibilityState === "hidden") return;
    // Pinch zoom should remain a browser operation, not trigger a layout reflow.
    if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
    const top = viewport?.offsetTop ?? 0;
    const height = viewport?.height ?? window.innerHeight;
    const geometry = `${top}:${height}`;
    if (geometry === lastGeometry) return;
    lastGeometry = geometry;
    Object.assign(shell.style, {
      position: "fixed",
      left: "0",
      right: "0",
      top: `${top}px`,
      height: `${height}px`,
      minHeight: "0",
      overflow: "hidden",
    });
    // The chat's existing top inset reserves the app header; bottom:0 keeps
    // the composer above the keyboard. Only its message list can scroll.
    panel.style.position = "absolute";
  };
  const schedule = () => {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
  };
  const needsCheck = () => {
    const active = document.activeElement;
    const editing =
      active instanceof HTMLElement &&
      shell.contains(active) &&
      (active.matches("input, textarea") || active.isContentEditable);
    const keyboardSized =
      viewport &&
      Math.abs(viewport.scale - 1) <= 0.01 &&
      window.innerHeight - viewport.height > 100;
    return Date.now() < settleUntil || editing || keyboardSized;
  };
  const check = () => {
    timer = undefined;
    if (disposed || document.visibilityState === "hidden") return;
    update();
    if (needsCheck()) timer = setTimeout(check, 250);
  };
  const changed = () => {
    schedule();
    // Safari can fire its last resize before the final keyboard geometry is
    // available. The keyboard's Hide button also leaves the textarea focused.
    // Keep checking while editing/reduced, plus a short settling period after
    // blur. Never infer "keyboard closed" from blur or force a scroll/blur.
    settleUntil = Date.now() + 1500;
    if (timer === undefined && document.visibilityState !== "hidden")
      timer = setTimeout(check, 250);
  };
  const visibility = () => {
    clearTimeout(timer);
    timer = undefined;
    if (document.visibilityState !== "hidden") changed();
  };
  update();
  if (needsCheck()) timer = setTimeout(check, 250);
  viewport?.addEventListener("resize", changed);
  viewport?.addEventListener("scroll", changed);
  window.addEventListener("resize", changed);
  window.addEventListener("orientationchange", changed);
  window.addEventListener("pageshow", changed);
  document.addEventListener("focusin", changed);
  document.addEventListener("focusout", changed);
  document.addEventListener("visibilitychange", visibility);
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    viewport?.removeEventListener("resize", changed);
    viewport?.removeEventListener("scroll", changed);
    window.removeEventListener("resize", changed);
    window.removeEventListener("orientationchange", changed);
    window.removeEventListener("pageshow", changed);
    document.removeEventListener("focusin", changed);
    document.removeEventListener("focusout", changed);
    document.removeEventListener("visibilitychange", visibility);
    if (previousStyle === null) shell.removeAttribute("style");
    else shell.setAttribute("style", previousStyle);
    panel.style.position = previousPosition;
  };
}
