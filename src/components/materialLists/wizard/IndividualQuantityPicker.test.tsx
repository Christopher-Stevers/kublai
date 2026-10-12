import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IndividualQuantityPicker } from "./IndividualQuantityPicker";
afterEach(() => {cleanup(); vi.unstubAllGlobals();});
it("shows the recorded unit and selects only after confirmation", () => {
  const select = vi.fn();
  render(<IndividualQuantityPicker partName="Pipe roll" unit="feet" onSelect={select} onCancel={() => {}} />);
  const drum = screen.getByRole("dialog", {name:"Quantity per foot"});
  fireEvent.wheel(drum, {deltaY:20});
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name:"Select 2 feet"}));
  expect(select).toHaveBeenCalledWith(2);
});
it("cancels without changing the existing quantity", () => {
  const select = vi.fn(), cancel = vi.fn();
  render(<IndividualQuantityPicker partName="Clips" unit="pcs" onSelect={select} onCancel={cancel} />);
  fireEvent.click(screen.getByRole("button", {name:"Cancel"}));
  expect(cancel).toHaveBeenCalledOnce();
  expect(select).not.toHaveBeenCalled();
});
it("dragging the individual drum commits that quantity on release", () => {
  class TestPointerEvent extends MouseEvent {pointerId=1;pointerType="touch";}
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  const select = vi.fn();
  render(<IndividualQuantityPicker partName="Clips" unit="pcs" onSelect={select} onCancel={() => {}} />);
  const drum = screen.getByRole("dialog");
  Object.assign(drum, {setPointerCapture:vi.fn()});
  fireEvent.pointerDown(drum, {clientY:100, button:0});
  fireEvent.pointerMove(drum, {clientY:262});
  expect(select).not.toHaveBeenCalled();
  fireEvent.pointerUp(drum);
  expect(select).toHaveBeenCalledWith(10);
});
