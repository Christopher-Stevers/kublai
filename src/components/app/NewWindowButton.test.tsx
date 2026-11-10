import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  SnapshotSourceContext,
  type SnapshotSourceRegistry,
} from "~/components/chat/SnapshotSourceContext";
const pages = vi.hoisted(() => ({ open: vi.fn(), show: vi.fn(), count: 3 }));
vi.mock("./AppPagesProvider", () => ({ useAppPages: () => pages }));
import { NewWindowButton, PageSwitcherButton } from "./NewWindowButton";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  pages.count = 3;
});
it("opens captured view inside ForemanHQ without a browser popup", () => {
  const popup = vi.spyOn(window, "open");
  const href = "/jobs/job/drawings?drawingSheet=sheet#snapshot=state";
  render(
    <SnapshotSourceContext.Provider
      value={{ captureSource: () => ({ href }) } as SnapshotSourceRegistry}
    >
      <NewWindowButton />
    </SnapshotSourceContext.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "New Page" }));
  expect(pages.open).toHaveBeenCalledWith(href);
  expect(popup).not.toHaveBeenCalled();
});
it("opens the page switcher from its count button", () => {
  pages.count = 1;
  const { rerender } = render(<PageSwitcherButton />);
  expect(screen.queryByRole("button", { name: /Open pages/ })).toBeNull();
  pages.count = 3;
  rerender(<PageSwitcherButton />);
  fireEvent.click(screen.getByRole("button", { name: "Open pages (3)" }));
  expect(pages.show).toHaveBeenCalledOnce();
  pages.count = 1;
  rerender(<PageSwitcherButton />);
  expect(screen.queryByRole("button", { name: /Open pages/ })).toBeNull();
});
