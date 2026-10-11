import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_DELIVERY_CALENDAR } from "~/lib/delivery-calendar";
const mocks = vi.hoisted(() => ({ saved: null as any, mutate: vi.fn(), get: vi.fn(), invalidate: vi.fn(), setData: vi.fn() }));
vi.mock("~/trpc/react", () => ({ api: {
  useUtils: () => ({ orderDelivery: { get: { setData: mocks.setData } }, materialList: { previewOrders: { invalidate: mocks.invalidate }, getOrderEmailContent: { invalidate: mocks.invalidate } } }),
  orderDelivery: {
    get: { useQuery: (...args: unknown[]) => { mocks.get(...args); return { data: mocks.saved }; } },
    preview: { useQuery: ({ calendar }: any) => ({ data: { countries: [{ code: "CA", name: "Canada" }, { code: "US", name: "United States" }], states: calendar?.country === "CA" ? [{ code: "ON", name: "Ontario" }] : [], regions: [], holidays: calendar?.country ? [{ key: "christmas", name: "Christmas Day", date: "2026-12-25", endDate: "2026-12-25", observed: false }] : [], nextDate: "2026-10-12" } }) },
    save: { useMutation: () => ({ mutate: mocks.mutate, isPending: false }) },
  },
} }));
import { DeliveryCalendarSettings } from "./DeliveryCalendarSettings";
beforeEach(() => { vi.clearAllMocks(); mocks.saved = { calendar: { ...DEFAULT_DELIVERY_CALENDAR }, revision: 0, userId: "user-a" }; });
afterEach(cleanup);
const open = () => fireEvent.click(screen.getByRole("button", { name: "Delivery calendar" }));
it("lets the user enable weekends, skip weekdays, and save their own calendar", () => {
  render(<DeliveryCalendarSettings online onSaved={vi.fn()} />); open();
  expect(screen.getByRole("switch", { name: "Skip Saturday" })).toHaveAttribute("aria-checked", "true");
  fireEvent.click(screen.getByRole("switch", { name: "Skip Saturday" }));
  fireEvent.click(screen.getByRole("switch", { name: "Skip Monday" }));
  fireEvent.click(screen.getByRole("button", { name: "Save calendar" }));
  expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ expectedUserId: "user-a", expectedRevision: 0, calendar: expect.objectContaining({ skippedWeekdays: [0, 1] }) }));
});
it("lists country holidays and allows individual holidays", () => {
  render(<DeliveryCalendarSettings online onSaved={vi.fn()} />); open();
  fireEvent.change(screen.getByLabelText("Holiday country"), { target: { value: "CA" } });
  expect(screen.getByLabelText("Holiday province or state")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Holiday province or state"), { target: { value: "ON" } });
  const holiday = screen.getByRole("switch", { name: /Allow deliveries on Christmas Day/ });
  expect(holiday).toHaveAttribute("aria-checked", "false"); fireEvent.click(holiday);
  fireEvent.click(screen.getByRole("button", { name: "Save calendar" }));
  expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ calendar: expect.objectContaining({ country: "CA", state: "ON", allowedHolidays: ["christmas"] }) }));
});
it("clears regional and holiday overrides when the country changes", () => {
  mocks.saved.calendar = { ...DEFAULT_DELIVERY_CALENDAR, country: "CA", state: "ON", allowedHolidays: ["christmas"] };
  render(<DeliveryCalendarSettings online onSaved={vi.fn()} />); open();
  fireEvent.change(screen.getByLabelText("Holiday country"), { target: { value: "US" } });
  fireEvent.click(screen.getByRole("button", { name: "Save calendar" }));
  expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ calendar: expect.objectContaining({ country: "US", state: null, region: null, allowedHolidays: [] }) }));
});
it("prevents all seven weekdays from being skipped", () => {
  render(<DeliveryCalendarSettings online onSaved={vi.fn()} />); open();
  for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]) fireEvent.click(screen.getByRole("switch", { name: `Skip ${day}` }));
  expect(screen.getByRole("alert")).toHaveTextContent("Keep at least one delivery weekday enabled.");
  expect(screen.getByRole("switch", { name: "Skip Friday" })).toHaveAttribute("aria-checked", "false");
});
it("keeps the original revision when another device updates while editing", () => {
  mocks.saved.revision = 4;
  const view = render(<DeliveryCalendarSettings online onSaved={vi.fn()} />); open();
  fireEvent.click(screen.getByRole("switch", { name: "Skip Monday" }));
  mocks.saved = { ...mocks.saved, revision: 5 };
  view.rerender(<DeliveryCalendarSettings online onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Save calendar" }));
  expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 4 }));
});
it("discards a previous account's draft and does not save while offline", () => {
  const view = render(<DeliveryCalendarSettings online onSaved={vi.fn()} />); open();
  fireEvent.click(screen.getByRole("switch", { name: "Skip Monday" }));
  mocks.saved = { calendar: DEFAULT_DELIVERY_CALENDAR, userId: "user-b", revision: 0 };
  view.rerender(<DeliveryCalendarSettings online onSaved={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Save calendar" })).toBeDisabled();
  view.rerender(<DeliveryCalendarSettings online={false} onSaved={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent("Reconnect");
  expect(mocks.mutate).not.toHaveBeenCalled();
});
