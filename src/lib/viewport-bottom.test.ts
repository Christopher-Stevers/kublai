import { afterEach, expect, it, vi } from "vitest";
import { bindViewportBottom } from "./viewport-bottom";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

it("moves fixed bottom bars down to the visible bottom when iPad leaves them floating", () => {
  const viewport = Object.assign(new EventTarget(), { height: 1180, offsetTop: 0, scale: 1 });
  vi.stubGlobal("visualViewport", viewport);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.push(fn); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  let fixedBottom = 1180;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ top: fixedBottom }) as DOMRect);
  const root = document.documentElement;
  const restore = bindViewportBottom(root);
  expect(root.style.getPropertyValue("--viewport-bottom")).toBe("");

  // Stale layout viewport: "bottom: 0" lands a keyboard's height above the screen edge.
  fixedBottom = 780;
  window.dispatchEvent(new Event("scroll"));
  viewport.dispatchEvent(new Event("scroll"));
  expect(frames).toHaveLength(1);
  frames.shift()!(0);
  expect(root.style.getPropertyValue("--viewport-bottom")).toBe("400px");

  // Keyboard open: the bar stays behind it as before.
  fixedBottom = 1180;
  viewport.height = 800;
  viewport.dispatchEvent(new Event("resize"));
  frames.shift()!(0);
  expect(root.style.getPropertyValue("--viewport-bottom")).toBe("");

  // Pinch zoom is left alone.
  fixedBottom = 780;
  viewport.height = 1180;
  viewport.scale = 2;
  window.dispatchEvent(new Event("resize"));
  frames.shift()!(0);
  expect(root.style.getPropertyValue("--viewport-bottom")).toBe("");

  restore();
  expect(document.body.children).toHaveLength(0);
});
