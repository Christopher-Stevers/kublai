import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SpeedDevelopmentOverlay, {
  frameWindow,
} from "./SpeedDevelopmentOverlay";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

it("ignores paint marks delivered while the document is hidden", () => {
  let observed!: PerformanceObserverCallback;
  vi.stubGlobal(
    "PerformanceObserver",
    class {
      static supportedEntryTypes = ["measure"];
      constructor(callback: PerformanceObserverCallback) {
        observed = callback;
      }
      observe() {
        /* Fixture only. */
      }
      disconnect() {
        /* Fixture only. */
      }
    },
  );
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  const visible = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("visible");
  history.replaceState(null, "", "/?speed=1");
  render(<SpeedDevelopmentOverlay />);
  const report = (duration: number) =>
    observed(
      {
        getEntries: () => [
          { name: "foremenhq:tap-to-paint", duration } as PerformanceEntry,
        ],
        getEntriesByType: () => [],
        getEntriesByName: () => [],
      },
      {} as PerformanceObserver,
    );
  act(() => report(200));
  expect(screen.getByText("200.0 ms")).toBeInTheDocument();
  act(() => {
    visible.mockReturnValue("hidden");
    report(350);
  });
  expect(screen.getByText("200.0 ms")).toBeInTheDocument();
  expect(screen.queryByText("350.0 ms")).not.toBeInTheDocument();
});

it("estimates missed slots at both 60 and 120 Hz without treating them as rendered-frame proof", () => {
  for (const interval of [1000 / 60, 1000 / 120]) {
    const result = frameWindow([
      ...Array<number>(30).fill(interval),
      interval * 3,
    ]);
    expect(result?.interval).toBeCloseTo(interval);
    expect(result?.missed).toBe(2);
  }
  expect(frameWindow([0, NaN, Infinity, -1, 16])).toBeNull();
});

it("does not sample unless explicitly requested, and stops when hidden or dismissed", () => {
  const callbacks = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callbacks.set(++next, callback);
    return next;
  });
  const cancel = vi
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation((id) => {
      callbacks.delete(id);
    });
  const visible = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("visible");
  render(<SpeedDevelopmentOverlay />);
  expect(callbacks.size).toBe(0);
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  act(() => {
    history.replaceState(null, "", "/?speed=1");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(screen.getByRole("complementary")).toBeInTheDocument();
  expect(callbacks.size).toBe(1);
  act(() => {
    visible.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(callbacks.size).toBe(0);
  expect(cancel).toHaveBeenCalled();
  act(() => {
    visible.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(callbacks.size).toBe(1);
  act(() =>
    screen.getByRole("button", { name: "Close speed overlay" }).click(),
  );
  expect(callbacks.size).toBe(0);
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
});
