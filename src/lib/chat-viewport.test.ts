import { afterEach, expect, it, vi } from "vitest";
import { bindChatViewport } from "./chat-viewport";

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

it("keeps the header and composer inside a resized and panned iPad viewport", () => {
  const viewport = Object.assign(new EventTarget(), { height: 1024, offsetTop: 0, scale: 1 });
  vi.stubGlobal("visualViewport", viewport);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.push(fn); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  document.body.innerHTML = '<div data-app-shell style="color: red"><header></header><section></section></div>';
  const shell = document.querySelector<HTMLElement>("[data-app-shell]")!;
  const panel = shell.querySelector("section")!;
  const restore = bindChatViewport(panel);
  expect(shell.style.height).toBe("1024px");
  expect(panel.style.position).toBe("absolute");
  viewport.height = 620;
  viewport.offsetTop = 180;
  viewport.dispatchEvent(new Event("resize"));
  viewport.dispatchEvent(new Event("scroll"));
  expect(frames).toHaveLength(1);
  frames.shift()!(0);
  expect(shell.style.top).toBe("180px");
  expect(shell.style.height).toBe("620px");
  expect(shell.style.minHeight).toBe("0px");
  viewport.height = 1024;
  viewport.offsetTop = 0;
  viewport.dispatchEvent(new Event("resize"));
  frames.shift()!(0);
  expect(shell.style.top).toBe("0px");
  expect(shell.style.height).toBe("1024px");
  restore();
  expect(shell.getAttribute("style")).toBe("color: red");
  expect(panel.style.position).toBe("");
  viewport.dispatchEvent(new Event("resize"));
  expect(frames).toHaveLength(0);
});
