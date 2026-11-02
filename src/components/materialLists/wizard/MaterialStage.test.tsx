import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MaterialStage, type MaterialStageProps } from "./MaterialStage";
afterEach(cleanup);
function props(): MaterialStageProps {
  return {
    materials: [
      { id: "xfr", name: "XFR", groupPath: ["PVC"], count: 8 },
      { id: "dwv", name: "PVC DWV", groupPath: ["PVC"], count: 4 },
      {
        id: "dr25",
        name: "Gasketed DR25",
        groupPath: ["PVC", "Gasketed SDR"],
        count: 5,
      },
      {
        id: "dr35",
        name: "Gasketed DR35",
        groupPath: ["PVC", "Gasketed SDR"],
        count: 7,
      },
      { id: "cu", name: "Copper", count: 10 },
    ],
    selectedMaterialId: null,
    onMaterialSelect: vi.fn(),
    showCustomMaterialInput: false,
    onShowCustomMaterialInput: vi.fn(),
    customMaterialName: "",
    onCustomMaterialNameChange: vi.fn(),
    onCreateMaterial: { mutate: vi.fn(), isPending: false },
    isOnline: false,
  };
}
it("browses PVC and gasketed subgroups offline without selecting a material prematurely", () => {
  const input = props();
  render(<MaterialStage {...input} />);
  expect(screen.queryByText("XFR")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "PVC" }));
  expect(input.onMaterialSelect).not.toHaveBeenCalled();
  expect(screen.getByText("XFR")).toBeInTheDocument();
  expect(screen.queryByText("Copper")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Gasketed SDR" }));
  fireEvent.click(screen.getByRole("button", { name: /Gasketed DR35/ }));
  expect(input.onMaterialSelect).toHaveBeenCalledWith("dr35");
});
it("returns to parent groups using breadcrumbs", () => {
  render(<MaterialStage {...props()} selectedMaterialId="dr35" />);
  expect(screen.getByText("Select Gasketed SDR type")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^PVC$/ }));
  expect(screen.getByText("XFR")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^All materials$/ }));
  expect(screen.getByText("Copper")).toBeInTheDocument();
  expect(screen.queryByText("XFR")).not.toBeInTheDocument();
});
it("leaves ungrouped selection and the All option intact", () => {
  const input = props();
  render(<MaterialStage {...input} />);
  fireEvent.click(screen.getByRole("button", { name: /Copper/ }));
  expect(input.onMaterialSelect).toHaveBeenCalledWith("cu");
  fireEvent.click(screen.getByText("All", { exact: true }));
  expect(input.onMaterialSelect).toHaveBeenLastCalledWith(null);
});

it("flattens grouped materials only in the arc scroller and selects a nested material directly", async () => {
  const { ArcScrollerSurface } = await import("~/components/ui/arc-scroller");
  const { wheelUsageId } = await import("~/lib/order-wheel-usage");
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 400,
    bottom: 700,
    width: 400,
    height: 700,
    toJSON() {},
  });
  try {
    const input = props();
    render(
      <ArcScrollerSurface
        usage={{ [wheelUsageId("Select Material", "Gasketed DR35")]: 10 }}
      >
        <MaterialStage {...input} />
      </ArcScrollerSurface>,
    );
    // Cards still browse groups; opening the arc from inside PVC still shows all materials.
    fireEvent.click(screen.getByRole("button", { name: "PVC" }));
    expect(screen.queryByRole("button", { name: "Copper" })).toBeNull();
    const pointer = { pointerId: 1, isPrimary: true, button: 0, clientX: 200, clientY: 300 };
    fireEvent.pointerDown(screen.getByRole("heading", { name: "Select PVC type" }), pointer);
    act(() => vi.advanceTimersByTime(400));
    fireEvent.pointerUp(window, pointer);
    act(() => vi.advanceTimersByTime(500));
    const arc = screen.getByRole("dialog", { name: "Select Material" });
    const labels = Array.from(arc.querySelectorAll("[data-arc-choice]")).map((n) => n.getAttribute("aria-label"));
    // Most used first, then the stage's own order.
    expect(labels[0]).toBe("Gasketed DR35");
    expect([...labels].sort()).toEqual(
      ["All", "Copper", "Gasketed DR25", "Gasketed DR35", "PVC DWV", "XFR"].sort(),
    );
    fireEvent.click(within(arc).getByRole("button", { name: "Gasketed DR35" }));
    expect(input.onMaterialSelect).toHaveBeenCalledExactlyOnceWith("dr35");
  } finally {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});
