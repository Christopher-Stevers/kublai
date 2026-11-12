import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SizeStage, type SizeStageProps } from "./SizeStage";
import { CategoryStage } from "./CategoryStage";

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "touch";
  }
}
const pointer = { pointerId: 1, pointerType: "touch", button: 0, clientX: 10, clientY: 10 };
const noop = () => {};
const sizes: SizeStageProps["availableSizes"] = [
  { nominal: 1, unit: "in", count: 2, subSizes: [{ label: "1 x 1/2", count: 1 }, { label: "1 x 3/4", count: 1 }] },
  { nominal: 2, unit: "in", count: 2 },
];
const selected = vi.fn();
function Steps() {
  const [stage, setStage] = useState("size");
  if (stage === "part") return <h3>Select Part</h3>;
  if (stage === "category") return <CategoryStage
    categories={[{ categoryId: "tees", name: "Tees" }, { categoryId: "elbows", name: "Elbows" }]}
    selectedCategory={null} onCategorySelect={() => setStage("part")}
    showCustomCategoryInput={false} onShowCustomCategoryInput={noop}
    customCategoryName="" onCustomCategoryNameChange={noop} onCustomCategorySubmit={noop}
  />;
  return <SizeStage availableSizes={sizes} selectedSize={null}
    onSizeSelect={(size) => { selected(size); setStage("category"); }}
    showCustomSize={false} onShowCustomSize={noop} customSizeInput=""
    onCustomSizeInputChange={noop} customSizeUnitId={null} onCustomSizeUnitIdChange={noop}
    allUnits={[]} onCreateSize={{ mutate: noop, isPending: false }}
  />;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
});
afterEach(() => {
  cleanup();
  act(() => vi.runOnlyPendingTimers());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const sizeCard = () => screen.getAllByRole("button")[1]!;

it.each(["touch", "mouse"])("does not let a %s size tap also choose a category", (pointerType) => {
  render(<Steps />);
  const card = sizeCard();
  fireEvent.pointerDown(card, { ...pointer, pointerType });
  fireEvent.pointerUp(card, { ...pointer, pointerType });
  expect(selected).toHaveBeenCalledOnce();
  // On mobile, the compatibility click can land on the newly rendered card.
  fireEvent.click(screen.getByRole("button", { name: "Tees" }), { detail: 1 });
  expect(screen.getByRole("heading", { name: "Select Category" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Elbows" })).toBeInTheDocument();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Tees" }), pointer);
  fireEvent.pointerUp(screen.getByRole("button", { name: "Tees" }), pointer);
  fireEvent.click(screen.getByRole("button", { name: "Tees" }), { detail: 1 });
  expect(screen.getByRole("heading", { name: "Select Part" })).toBeInTheDocument();
});

it("allows a fresh tap immediately when the browser sends no compatibility click", () => {
  render(<Steps />);
  fireEvent.pointerDown(sizeCard(), pointer);
  fireEvent.pointerUp(sizeCard(), pointer);
  fireEvent.pointerDown(screen.getByRole("button", { name: "Tees" }), pointer);
  fireEvent.pointerUp(screen.getByRole("button", { name: "Tees" }), pointer);
  fireEvent.click(screen.getByRole("button", { name: "Tees" }), { detail: 1 });
  expect(screen.getByRole("heading", { name: "Select Part" })).toBeInTheDocument();
});

it.each(["touch", "mouse"])("keeps categories visible after a held %s sub-size choice", (pointerType) => {
  render(<Steps />);
  const card = sizeCard();
  fireEvent.pointerDown(card, { ...pointer, pointerType });
  act(() => vi.advanceTimersByTime(250));
  fireEvent.pointerUp(card, { ...pointer, pointerType });
  if (pointerType === "touch") fireEvent.touchEnd(window, { touches: [] });
  expect(selected).toHaveBeenCalledExactlyOnceWith({ nominal: 1, unit: "in", sizeLabel: "1 x 1/2" });
  fireEvent.click(screen.getByRole("button", { name: "Elbows" }), { detail: 1 });
  expect(screen.getByRole("heading", { name: "Select Category" })).toBeInTheDocument();
});

it("ignores a release that did not start on this size card", () => {
  render(<Steps />);
  fireEvent.pointerUp(sizeCard(), pointer);
  expect(selected).not.toHaveBeenCalled();
  fireEvent.pointerDown(sizeCard(), pointer);
  fireEvent.pointerUp(sizeCard(), { ...pointer, pointerId: 2 });
  expect(selected).not.toHaveBeenCalled();
});

it("does not choose a size after scrolling or cancelling the gesture", () => {
  render(<Steps />);
  fireEvent.pointerDown(sizeCard(), pointer);
  fireEvent.pointerMove(sizeCard(), { ...pointer, clientY: 40 });
  fireEvent.pointerUp(sizeCard(), { ...pointer, clientY: 40 });
  expect(selected).not.toHaveBeenCalled();
  fireEvent.pointerDown(sizeCard(), pointer);
  fireEvent.pointerCancel(sizeCard(), pointer);
  fireEvent.pointerUp(sizeCard(), pointer);
  expect(selected).not.toHaveBeenCalled();
});

it("retains keyboard choices at both steps", () => {
  render(<Steps />);
  fireEvent.keyDown(sizeCard(), { key: "Enter" });
  fireEvent.keyDown(screen.getByRole("button", { name: "Tees" }), { key: " " });
  expect(screen.getByRole("heading", { name: "Select Part" })).toBeInTheDocument();
});
