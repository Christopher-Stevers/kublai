import { afterEach, expect, it, vi } from "vitest";
import { bindChatViewport } from "./chat-viewport";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

it("keeps the header and composer inside a resized and panned iPad viewport", () => {
  const viewport = Object.assign(new EventTarget(), {
    height: 1024,
    offsetTop: 0,
    scale: 1,
  });
  vi.stubGlobal("visualViewport", viewport);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frames.push(fn);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  document.body.innerHTML =
    '<div data-app-shell style="color: red"><header></header><section></section></div>';
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

it("recovers after Safari's final event precedes keyboard dismissal, even with focus retained", () => {
  vi.useFakeTimers();
  const viewport = Object.assign(new EventTarget(), {
    height: 800,
    offsetTop: 0,
    scale: 1,
  });
  vi.stubGlobal("visualViewport", viewport);
  vi.stubGlobal("innerHeight", 800);
  document.body.innerHTML =
    "<div data-app-shell><section><textarea></textarea></section></div>";
  const shell = document.querySelector<HTMLElement>("[data-app-shell]")!;
  const panel = shell.querySelector("section")!;
  const input = shell.querySelector("textarea")!;
  const restore = bindChatViewport(panel);
  input.focus();
  viewport.height = 410;
  viewport.offsetTop = 90;
  viewport.dispatchEvent(new Event("resize"));
  vi.advanceTimersByTime(2000);
  expect(shell.style.height).toBe("410px");
  // iPad Hide Keyboard: focus remains; geometry settles without a final event.
  viewport.height = 800;
  viewport.offsetTop = 0;
  vi.advanceTimersByTime(250);
  expect(document.activeElement).toBe(input);
  expect(shell.style.height).toBe("800px");
  expect(shell.style.top).toBe("0px");
  input.blur();
  vi.advanceTimersByTime(2000);
  expect(vi.getTimerCount()).toBe(0);
  restore();
});

it("settles after blur without expanding prematurely while the keyboard is still visible", () => {
  vi.useFakeTimers();
  const viewport = Object.assign(new EventTarget(), {
    height: 800,
    offsetTop: 0,
    scale: 1,
  });
  vi.stubGlobal("visualViewport", viewport);
  vi.stubGlobal("innerHeight", 800);
  document.body.innerHTML =
    "<div data-app-shell><section><textarea></textarea></section></div>";
  const shell = document.querySelector<HTMLElement>("[data-app-shell]")!;
  const input = shell.querySelector("textarea")!;
  const restore = bindChatViewport(shell.querySelector("section")!);
  input.focus();
  viewport.height = 400;
  input.blur();
  vi.advanceTimersByTime(250);
  expect(shell.style.height).toBe("400px");
  viewport.height = 800;
  vi.advanceTimersByTime(250);
  expect(shell.style.height).toBe("800px");
  restore();
  expect(vi.getTimerCount()).toBe(0);
  viewport.height = 300;
  window.dispatchEvent(new Event("pageshow"));
  input.focus();
  vi.advanceTimersByTime(2000);
  expect(shell.getAttribute("style")).toBe(null);
});

it("preserves pinch zoom and refreshes after rotation or returning to the app", () => {
  vi.useFakeTimers();
  const viewport = Object.assign(new EventTarget(), {
    height: 800,
    offsetTop: 0,
    scale: 1,
  });
  vi.stubGlobal("visualViewport", viewport);
  document.body.innerHTML = "<div data-app-shell><section></section></div>";
  const shell = document.querySelector<HTMLElement>("[data-app-shell]")!;
  const restore = bindChatViewport(shell.querySelector("section")!);
  viewport.scale = 2;
  viewport.height = 400;
  viewport.dispatchEvent(new Event("resize"));
  vi.advanceTimersByTime(500);
  expect(shell.style.height).toBe("800px");
  viewport.scale = 1;
  viewport.height = 600;
  window.dispatchEvent(new Event("orientationchange"));
  vi.advanceTimersByTime(250);
  expect(shell.style.height).toBe("600px");
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  vi.advanceTimersByTime(500);
  expect(vi.getTimerCount()).toBe(0);
  viewport.height = 850;
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  vi.advanceTimersByTime(250);
  expect(shell.style.height).toBe("850px");
  restore();
});
