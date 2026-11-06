import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  CatalogueVisibilityProvider,
  hidesCriteria,
} from "./CatalogueVisibility";
import { WizardOptionCard } from "~/components/materialLists/wizard/WizardOptionGrid";
const show = vi.fn();
const hide = vi.fn(),
  tap = vi.fn();
const scope = { catalogId: "catalog", materialId: "material" };
function Card({
  enabled = true,
  hidden = false,
}: {
  enabled?: boolean;
  hidden?: boolean;
}) {
  return (
    <CatalogueVisibilityProvider
      value={{
        scope,
        rules: hidden ? [{ id: "rule", ...scope }] : [],
        enabled,
        hide, show,
      }}
    >
      <WizardOptionCard
        onClick={tap}
        hideCriteria={{ size: { nominal: 2, unit: "in" } }}
      >
        <span>2 inch</span>
      </WizardOptionCard>
    </CatalogueVisibilityProvider>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("PointerEvent", MouseEvent);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("hides the scoped choice once without selecting it on release", () => {
  const view = render(<Card />),
    card = screen.getByRole("button");
  fireEvent.pointerDown(screen.getByText("2 inch"), { button: 0, clientX: 10, clientY: 10 });
  act(() => vi.advanceTimersByTime(600));
  expect(hide).toHaveBeenCalledExactlyOnceWith([
    { ...scope, size: { nominal: 2, unit: "in" } },
  ]);
  view.rerender(<Card hidden />);
  fireEvent.pointerUp(card, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.click(card, { detail: 1 });
  expect(tap).not.toHaveBeenCalled();
  expect(
    screen.getByLabelText("Hidden from material lists"),
  ).toBeInTheDocument();
});
it("keeps a short tap and cancels hiding when scrolling", () => {
  render(<Card />);
  const card = screen.getByRole("button");
  fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10 });
  act(() => vi.advanceTimersByTime(100));
  fireEvent.pointerUp(card);
  fireEvent.click(card, { detail: 1 });
  expect(tap).toHaveBeenCalledTimes(1);
  fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(card, { clientX: 10, clientY: 35 });
  act(() => vi.advanceTimersByTime(700));
  fireEvent.pointerUp(card);
  fireEvent.click(card, { detail: 1 });
  expect(hide).not.toHaveBeenCalled();
  expect(tap).toHaveBeenCalledTimes(1);
});
it("cancels on pointer cancellation and unmount", () => {
  const view = render(<Card />);
  const card = screen.getByRole("button");
  fireEvent.pointerDown(card, { button: 0 });
  fireEvent.pointerCancel(card);
  act(() => vi.advanceTimersByTime(700));
  expect(hide).not.toHaveBeenCalled();
  fireEvent.pointerDown(card, { button: 0 });
  view.unmount();
  act(() => vi.advanceTimersByTime(700));
  expect(hide).not.toHaveBeenCalled();
});
it("keeps hidden entries browsable and respects edit permissions", () => {
  render(<Card hidden enabled={false} />);
  const card = screen.getByRole("button");
  fireEvent.pointerDown(card, { button: 0 });
  act(() => vi.advanceTimersByTime(700));
  expect(hide).not.toHaveBeenCalled();
  fireEvent.click(card);
  expect(tap).toHaveBeenCalledOnce();
  expect(screen.getByText("Hidden")).toBeInTheDocument();
});
it("only treats a group as hidden when a rule covers that group", () => {
  expect(hidesCriteria({ catalogId: "catalog" }, scope)).toBe(true);
  expect(hidesCriteria({ partId: "part" }, scope)).toBe(false);
  expect(
    hidesCriteria({ ...scope, size: { nominal: 2, unit: "in" } }, scope),
  ).toBe(false);
  expect(hidesCriteria({ materialId: "other" }, scope)).toBe(false);
});
it("unhides across all groups when checked and already hidden", () => {
  render(
    <CatalogueVisibilityProvider
      value={{
        scope,
        rules: [{ id: "rule", ...scope, size: { nominal: 2, unit: "in" } }],
        enabled: true,
        acrossAll: true,
        hide, show,
      }}
    >
      <WizardOptionCard
        onClick={tap}
        hideCriteria={{ size: { nominal: 2, unit: "in" } }}
      >
        <span>2 inch</span>
      </WizardOptionCard>
    </CatalogueVisibilityProvider>,
  );
  fireEvent.pointerDown(screen.getByRole("button"), { button: 0 });
  act(() => vi.advanceTimersByTime(600));
  expect(show).toHaveBeenCalledExactlyOnceWith([
    { size: { nominal: 2, unit: "in" } },
  ]);
});
it("hides every material in a group in one request", () => {
  render(
    <CatalogueVisibilityProvider
      value={{
        scope: { catalogId: "catalog" },
        rules: [],
        enabled: true,
        hide, show,
      }}
    >
      <WizardOptionCard
        onClick={tap}
        hideCriteria={[{ materialId: "xfr" }, { materialId: "system15" }]}
      >
        PVC
      </WizardOptionCard>
    </CatalogueVisibilityProvider>,
  );
  fireEvent.pointerDown(screen.getByRole("button"), { button: 0 });
  act(() => vi.advanceTimersByTime(600));
  expect(hide).toHaveBeenCalledExactlyOnceWith([
    { catalogId: "catalog", materialId: "xfr" },
    { catalogId: "catalog", materialId: "system15" },
  ]);
});
it("hides individual parts by identity and marks parts hidden by parent rules", () => {
  render(
    <CatalogueVisibilityProvider
      value={{ scope, rules: [], hiddenPartIds: ["part"], enabled: true, hide, show }}
    >
      <WizardOptionCard onClick={tap} hideCriteria={{ partId: "part" }}>
        Part
      </WizardOptionCard>
    </CatalogueVisibilityProvider>,
  );
  expect(screen.getByText("Hidden")).toBeInTheDocument();
  fireEvent.pointerDown(screen.getByRole("button"), { button: 0 });
  act(() => vi.advanceTimersByTime(600));
  expect(show).toHaveBeenCalledExactlyOnceWith([{ partId: "part" }]);
});
