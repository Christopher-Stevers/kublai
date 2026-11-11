import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Activity, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { navigationPaint, navigationScreen } from "~/lib/navigation-paint";
import { setAppPageActive } from "~/lib/app-page-activity";
import {
  useJobWorkspaceNavigation,
  resetJobWorkspaceNavigation,
} from "./use-job-workspace-navigation";
const measured = vi.fn();
const frames = new Map<number, FrameRequestCallback>();
let serial = 0;
function UI() {
  const nav = useJobWorkspaceNavigation(),
    [loading, setLoading] = useState(true);
  return (
    <>
      <button
        onClick={() =>
          nav.navigate({
            jobId: "private-never-emitted",
            view: "material-lists",
            materialListId: "private-line",
          })
        }
      >
        Open
      </button>
      <button onClick={nav.back}>Back</button>
      <button onClick={() => setLoading(false)}>Ready</button>
      <span>{nav.location ? "List committed" : "Jobs committed"}</span>
      {nav.location && loading && <div data-workspace-loading />}
    </>
  );
}
function frame() {
  act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((fn) => fn(100));
  });
}
/** Injected trusted-input model; this is React commit/correlation proof, not a browser isTrusted or hardware test. */
function input(action: () => void) {
  const token = navigationPaint.beginInput(true);
  act(action);
  navigationPaint.endDispatch(token);
}
beforeEach(() => {
  measured.mockClear();
  localStorage.clear();
  history.replaceState(null, "", "/jobs");
  setAppPageActive(true);
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frames.set(++serial, fn);
    return serial;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (
    this: Element,
  ) {
    return this.closest('[hidden],[style*="display: none"]')
      ? ([] as unknown as DOMRectList)
      : ([{ width: 10, height: 10 }] as unknown as DOMRectList);
  });
  vi.stubGlobal("performance", { now: () => 100, measure: measured });
});
afterEach(() => {
  cleanup();
  navigationPaint.cancel();
  frames.clear();
  setAppPageActive(true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("initial restore/programmatic navigation/same destination do not invent taps, and local context is allowlisted", () => {
  render(<UI />);
  frame();
  frame();
  expect(measured).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Open"));
  frame();
  frame();
  expect(measured).not.toHaveBeenCalled();
  expect(navigationScreen()).toBe("materials");
  input(() => fireEvent.click(screen.getByText("Open")));
  frame();
  frame();
  expect(measured).not.toHaveBeenCalled();
});
it("a real local commit waits for loading removal; app back gets a separate numeric measure", async () => {
  render(<UI />);
  input(() => fireEvent.click(screen.getByText("Open")));
  expect(screen.getByText("List committed")).toBeTruthy();
  frame();
  frame();
  expect(measured).not.toHaveBeenCalled();
  act(() => {
    fireEvent.click(screen.getByText("Ready"));
  });
  await act(async () => {
    await Promise.resolve();
  });
  frame();
  frame();
  expect(measured).toHaveBeenCalledTimes(1);
  input(() => fireEvent.click(screen.getByText("Back")));
  frame();
  frame();
  expect(measured).toHaveBeenCalledTimes(2);
  expect(navigationScreen()).toBe("materials");
  expect(JSON.stringify(measured.mock.calls)).not.toContain("private");
});
it("Activity/internal pause and programmatic reset cannot finish a superseded local read", async () => {
  const view = render(
    <Activity mode="visible">
      <UI />
    </Activity>,
  );
  input(() => fireEvent.click(screen.getByText("Open")));
  view.rerender(
    <Activity mode="hidden">
      <UI />
    </Activity>,
  );
  view.rerender(
    <Activity mode="visible">
      <UI />
    </Activity>,
  );
  act(() => setAppPageActive(false));
  act(() => setAppPageActive(true));
  act(() => resetJobWorkspaceNavigation());
  frame();
  frame();
  expect(measured).not.toHaveBeenCalled();
});
