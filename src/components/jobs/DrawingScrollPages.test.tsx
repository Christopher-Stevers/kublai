import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DrawingScrollPages } from "./DrawingScrollPages";
import { DrawingPageModeSetting, useDrawingPageMode } from "./DrawingPageMode";
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value)});
  vi.stubGlobal("ResizeObserver", class { observe() { return undefined; } disconnect() { return undefined; } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("shares and remembers the document/drawing mode across mounted settings", () => {
  function Reader() { return <output>{useDrawingPageMode().scroll ? "Scrolling" : "Buttons"}</output>; }
  const view = render(<><DrawingPageModeSetting /><Reader /></>);
  fireEvent.click(screen.getByRole("switch"));
  expect(screen.getByText("Scrolling")).toBeVisible();
  view.unmount();
  render(<DrawingPageModeSetting />);
  expect(screen.getByRole("switch")).toBeChecked();
});
it("activates the visible page without snapping the scroll, and follows explicit page jumps", () => {
  const sheets = [0,1,2].map(n => ({id: String(n), name: "Page "+n, imageUrl: "/"+n+".webp", width: 800, height: 600}));
  const onPage = vi.fn();
  const props = {enabled: true, sheets, index: 0, onPage, children: <div>Active viewer</div>};
  const view = render(<DrawingScrollPages {...props} />);
  const node = screen.getByLabelText("Scrolling pages");
  Object.defineProperty(node, "clientHeight", {value: 600});
  Array.from(node.children).forEach((page,n) => Object.defineProperties(page, {offsetTop: {value: n*600}, offsetHeight: {value: 600}}));
  node.scrollTop = 420;
  fireEvent.scroll(node);
  expect(onPage).toHaveBeenCalledWith(1);
  view.rerender(<DrawingScrollPages {...props} index={1} />);
  expect(node.scrollTop).toBe(420);
  expect(screen.getByText("Active viewer").closest("section")).toHaveAttribute("aria-label", "Page 1");
  view.rerender(<DrawingScrollPages {...props} index={2} />);
  expect(node.scrollTop).toBe(1200);
  view.rerender(<DrawingScrollPages {...props} enabled={false} />);
  expect(screen.queryByLabelText("Scrolling pages")).toBeNull();
  expect(screen.getByText("Active viewer")).toBeVisible();
});
