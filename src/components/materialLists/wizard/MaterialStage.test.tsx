import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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

it("flattens grouped materials only in the wheel and selects a nested material directly", async () => {
  const { QuickWheelSurface } = await import("./QuickWheel");
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
    const { container } = render(
      <QuickWheelSurface
        usage={{ [wheelUsageId("Select Material", "Gasketed DR35")]: 10 }}
      >
        <MaterialStage {...input} />
      </QuickWheelSurface>,
    );
    // Cards still browse groups; opening the wheel from inside PVC still shows all materials.
    fireEvent.click(screen.getByRole("button", { name: "PVC" }));
    expect(screen.queryByRole("button", { name: "Copper" })).toBeNull();
    const pointer = {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 200,
      clientY: 300,
    };
    fireEvent.pointerDown(
      screen.getByRole("heading", { name: "Select PVC type" }),
      pointer,
    );
    const wheel = screen.getByRole("status");
    expect(wheel).toHaveAttribute("aria-label", "Select Material quick wheel");
    const labels = Array.from(wheel.querySelectorAll("foreignObject"));
    expect(labels.map((n) => n.textContent).sort()).toEqual(
      [
        "All",
        "Copper",
        "Gasketed DR25",
        "Gasketed DR35",
        "PVC DWV",
        "XFR",
      ].sort(),
    );
    const label = labels.find((n) => n.textContent === "Gasketed DR35")!;
    const x =
      Number(label.getAttribute("x")) +
      Number(label.getAttribute("width")) / 2 +
      30;
    const y =
      Number(label.getAttribute("y")) +
      Number(label.getAttribute("height")) / 2 +
      130;
    fireEvent.pointerMove(window, { ...pointer, clientX: x, clientY: y });
    await act(async () => vi.advanceTimersByTime(500));
    expect(input.onMaterialSelect).toHaveBeenCalledExactlyOnceWith("dr35");
    fireEvent.pointerUp(window, pointer);
    expect(container.querySelector("[data-quick-wheel]")).toBeNull();
  } finally {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});
