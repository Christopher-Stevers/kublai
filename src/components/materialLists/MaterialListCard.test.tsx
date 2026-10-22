import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { MaterialListCard } from "./MaterialListCard";
vi.mock("~/components/permissions/FinancialVisibility", () => ({
  FinancialOnly: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function props(): ComponentProps<typeof MaterialListCard> {
  return {
    list: {
      id: "one",
      name: "October 14",
      kind: "materials",
      createdAt: "2026-10-14T12:00:00Z",
      itemCount: 18,
      materialTotal: 20,
      orderNumbers: ["ORDER-155", "ORDER-156"],
      orderStatuses: [
        {
          id: "155",
          number: "ORDER-155",
          complete: true,
          deliveredPercent: 100,
        },
        {
          id: "156",
          number: "ORDER-156",
          complete: false,
          deliveredPercent: 25,
        },
      ],
      overallProgress: 62.5,
      sentSupplierCount: 2,
      totalSupplierCount: 2,
      verifiedSupplierCount: 1,
    },
    merge: {
      active: false,
      isPending: false,
      begin: vi.fn(),
      pick: vi.fn(),
      cardProps: () => ({ ref: () => {} }),
      cardClassName: () => "",
      banner: null,
    },
    canEdit: true,
    canDelete: true,
    actionsBusy: false,
    onOpen: vi.fn(),
    onOrders: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
  };
}
it("shows all linked orders and status in the shared card and opens on click", () => {
  const p = props();
  render(<MaterialListCard {...p} />);
  expect(screen.getByText("ORDER-155")).toBeTruthy();
  expect(screen.getByText("ORDER-156")).toBeTruthy();
  expect(screen.queryByText("1/2 verified")).toBeNull();
  expect(
    screen
      .getByLabelText("ORDER-155: 100% complete and verified")
      .getAttribute("title"),
  ).toBe("100% delivered · fully verified");
  expect(
    screen
      .getByLabelText("ORDER-156: not fully complete and verified")
      .getAttribute("title"),
  ).toBe("25% delivered");
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
    "63",
  );
  fireEvent.click(screen.getByText("October 14"));
  expect(p.onOpen).toHaveBeenCalledOnce();
});
it("opens orders on long press, suppresses navigation, and cancels when scrolling", () => {
  vi.useFakeTimers();
  vi.stubGlobal("PointerEvent", MouseEvent);
  const p = props();
  render(<MaterialListCard {...p} />);
  const card = screen.getByText("October 14").closest('[data-slot="card"]')!;
  fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10 });
  vi.advanceTimersByTime(550);
  expect(p.onOrders).toHaveBeenCalledOnce();
  fireEvent.click(card);
  expect(p.onOpen).not.toHaveBeenCalled();
  fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(card, { clientX: 10, clientY: 50 });
  vi.advanceTimersByTime(600);
  expect(p.onOrders).toHaveBeenCalledOnce();
});
it("routes clicks to merge selection instead of opening the list", () => {
  const p = props();
  p.merge.active = true;
  render(<MaterialListCard {...p} />);
  fireEvent.click(screen.getByText("October 14"));
  expect(p.merge.pick).toHaveBeenCalledWith(p.list);
  expect(p.onOpen).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "More actions for October 14" }),
  ).toBeNull();
});
it("does not start order selection from the actions button", () => {
  vi.useFakeTimers();
  vi.stubGlobal("PointerEvent", MouseEvent);
  const p = props();
  render(<MaterialListCard {...p} />);
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "More actions for October 14" }),
    { button: 0 },
  );
  vi.advanceTimersByTime(600);
  expect(p.onOrders).not.toHaveBeenCalled();
  expect(p.onOpen).not.toHaveBeenCalled();
});
