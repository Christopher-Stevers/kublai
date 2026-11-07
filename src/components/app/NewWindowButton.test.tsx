import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  SnapshotSourceContext,
  type SnapshotSourceRegistry,
} from "~/components/chat/SnapshotSourceContext";
import { NewWindowButton } from "./NewWindowButton";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("opens distinct windows with the captured page and leaves this window in place", () => {
  const windows = Array.from({ length: 2 }, () => ({
    opener: window as Window | null,
    location: { replace: vi.fn() },
    focus: vi.fn(),
  }));
  const open = vi
    .spyOn(window, "open")
    .mockReturnValueOnce(windows[0] as unknown as Window)
    .mockReturnValueOnce(windows[1] as unknown as Window);
  const href = "/jobs/job/drawings?drawingSheet=sheet#snapshot=state";
  const registry = {
    captureSource: () => ({
      href,
      title: "Drawing",
      capturedAt: new Date().toISOString(),
    }),
  } as SnapshotSourceRegistry;
  const original = window.location.href;
  render(
    <SnapshotSourceContext.Provider value={registry}>
      <NewWindowButton />
    </SnapshotSourceContext.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "New Window" }));
  fireEvent.click(screen.getByRole("button", { name: "New Window" }));
  expect(open).toHaveBeenCalledTimes(2);
  expect(open).toHaveBeenCalledWith(
    "",
    "_blank",
    expect.stringContaining("popup=yes"),
  );
  for (const child of windows) {
    expect(child.opener).toBeNull();
    expect(child.location.replace).toHaveBeenCalledWith(href);
  }
  expect(window.location.href).toBe(original);
});
it("explains when the browser blocks a new window", () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  render(<NewWindowButton />);
  fireEvent.click(screen.getByRole("button", { name: "New Window" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Allow pop-ups for ForemanHQ",
  );
});
