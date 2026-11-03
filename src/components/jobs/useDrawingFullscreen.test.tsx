import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDrawingFullscreen } from "./useDrawingFullscreen";

const key = (orientation: string) => `foremanhq:drawing-fullscreen:${orientation}`;
let storage: Map<string, string>;
function rotate(angle: number) {
  vi.stubGlobal("orientation", angle);
  fireEvent(window, new Event("orientationchange"));
}
function Viewer({ active = true }: { active?: boolean }) {
  const full = useDrawingFullscreen(active);
  return <div ref={full.surface}>
    <output>{full.fullscreen ? "fullscreen" : "normal"}</output>
    <button ref={full.enterButton} onClick={full.enter}>Enter</button>
    <button ref={full.exitButton} onClick={full.exit}>Exit</button>
  </div>;
}
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal("orientation", 0);
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("defaults to normal portrait and fullscreen landscape without saving automatic choices", () => {
  render(<Viewer />);
  expect(screen.getByRole("status")).toHaveTextContent("normal");
  rotate(90);
  expect(screen.getByRole("status")).toHaveTextContent("fullscreen");
  rotate(0);
  expect(screen.getByRole("status")).toHaveTextContent("normal");
  expect(storage.size).toBe(0);
});

it("starts fullscreen when a landscape drawing first opens", () => {
  rotate(90);
  render(<Viewer />);
  expect(screen.getByRole("status")).toHaveTextContent("fullscreen");
});

it("remembers independent choices across rotation, closing and reopening, and remounting", () => {
  const view = render(<Viewer />);
  fireEvent.click(screen.getByText("Enter"));
  rotate(90);
  fireEvent.click(screen.getByText("Exit"));
  expect(storage.get(key("portrait"))).toBe("true");
  expect(storage.get(key("landscape"))).toBe("false");
  rotate(0);
  expect(screen.getByRole("status")).toHaveTextContent("fullscreen");
  view.rerender(<Viewer active={false} />);
  expect(screen.getByRole("status")).toHaveTextContent("normal");
  view.rerender(<Viewer />);
  expect(screen.getByRole("status")).toHaveTextContent("fullscreen");
  view.unmount();
  render(<Viewer />);
  expect(screen.getByRole("status")).toHaveTextContent("fullscreen");
  rotate(90);
  expect(screen.getByRole("status")).toHaveTextContent("normal");
});

it("keeps desktop on the portrait preference and ignores same-orientation resizing", () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: !query.includes("pointer"), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  storage.set(key("landscape"), "true");
  render(<Viewer />);
  expect(screen.getByRole("status")).toHaveTextContent("normal");
  fireEvent.click(screen.getByText("Enter"));
  fireEvent(window, new Event("resize"));
  expect(screen.getByRole("status")).toHaveTextContent("fullscreen");
  expect(storage.get(key("portrait"))).toBe("true");
});

it("remembers Escape as an exit choice for only the current orientation", () => {
  rotate(90);
  render(<Viewer />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(storage.get(key("landscape"))).toBe("false");
  expect(storage.has(key("portrait"))).toBe(false);
  rotate(0);
  rotate(90);
  expect(screen.getByRole("status")).toHaveTextContent("normal");
});

it("does not save an internal native exit during rotation as the new orientation's preference", async () => {
  let element: Element | null = null;
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => element });
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: function(this: HTMLElement) {
    element = this;
    fireEvent(document, new Event("fullscreenchange"));
    return Promise.resolve();
  } });
  Object.defineProperty(document, "exitFullscreen", { configurable: true, value: vi.fn(async () => {
    element = null;
    fireEvent(document, new Event("fullscreenchange"));
  }) });
  try {
    rotate(90);
    render(<Viewer />);
    await act(async () => fireEvent.click(screen.getByText("Enter")));
    await act(async () => rotate(0));
    expect(storage.get(key("landscape"))).toBe("true");
    expect(storage.has(key("portrait"))).toBe(false);
    rotate(90);
    expect(screen.getByRole("status")).toHaveTextContent("fullscreen");
  } finally {
    Reflect.deleteProperty(document, "fullscreenElement");
    Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
    Reflect.deleteProperty(document, "exitFullscreen");
  }
});

it("still applies defaults and session choices when storage is unavailable", () => {
  vi.stubGlobal("localStorage", { getItem: () => { throw Error("unavailable"); }, setItem: () => { throw Error("unavailable"); } });
  rotate(90);
  render(<Viewer />);
  expect(screen.getByRole("status")).toHaveTextContent("fullscreen");
  fireEvent.click(screen.getByText("Exit"));
  rotate(0);
  rotate(90);
  expect(screen.getByRole("status")).toHaveTextContent("normal");
});


it.each([true, false])("preserves portrait fullscreen when app switching ends native fullscreen (hidden first=%s)", async hiddenFirst => {
  let element: Element | null = null;
  let hidden = false;
  const request = vi.fn(function(this: HTMLElement) {
    element = this;
    fireEvent(document, new Event("fullscreenchange"));
    return Promise.resolve();
  });
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => element });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: request });
  const visibility = (value: boolean) => {
    hidden = value;
    fireEvent(document, new Event("visibilitychange"));
  };
  try {
    const view = render(<Viewer />);
    await act(async () => fireEvent.click(screen.getByText("Enter")));
    if (hiddenFirst) visibility(true);
    element = null;
    fireEvent(document, new Event("fullscreenchange"));
    if (!hiddenFirst) visibility(true);
    visibility(false);
    fireEvent(window, new Event("pageshow"));
    expect(screen.getByRole("status")).toHaveTextContent("fullscreen");
    expect(storage.get(key("portrait"))).toBe("true");
    expect(request).toHaveBeenCalledOnce();
    view.unmount();
    render(<Viewer />);
    expect(screen.getByRole("status")).toHaveTextContent("fullscreen");
    fireEvent.click(screen.getByText("Exit"));
    expect(storage.get(key("portrait"))).toBe("false");
    expect(screen.getByRole("status")).toHaveTextContent("normal");
  } finally {
    Reflect.deleteProperty(document, "fullscreenElement");
    Reflect.deleteProperty(document, "hidden");
    Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
  }
});
