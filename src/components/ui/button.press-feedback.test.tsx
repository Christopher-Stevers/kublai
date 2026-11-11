import { Profiler } from "react";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Button } from "./button";
beforeAll(() => {
  class Pointer extends MouseEvent {
    pointerId: number;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  vi.stubGlobal("PointerEvent", Pointer);
});
afterEach(cleanup);
afterAll(() => vi.unstubAllGlobals());
const down = (node: Element) =>
  fireEvent.pointerDown(node, {
    pointerId: 1,
    isPrimary: true,
    button: 0,
    clientX: 10,
    clientY: 10,
  });
const up = () =>
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 10 });
it("actual Button attribute feedback avoids visual-only commits while default stays state based", () => {
  const commits = { state: 0, attribute: 0 };
  render(
    <>
      <Profiler id="state" onRender={() => commits.state++}>
        <Button>Default</Button>
      </Profiler>
      <Profiler id="attribute" onRender={() => commits.attribute++}>
        <Button pressFeedback="attribute">Attribute</Button>
      </Profiler>
    </>,
  );
  const initial = { ...commits };
  const state = screen.getByText("Default"),
    attribute = screen.getByText("Attribute");
  down(state);
  expect(state).toHaveAttribute("data-pressed", "true");
  up();
  expect(state).not.toHaveAttribute("data-pressed");
  expect(commits.state).toBe(initial.state + 2);
  down(attribute);
  expect(attribute).toHaveAttribute("data-pressed", "true");
  up();
  expect(attribute).not.toHaveAttribute("data-pressed");
  expect(commits.attribute).toBe(initial.attribute);
  expect(attribute).not.toHaveAttribute("pressFeedback");
  expect(attribute).not.toHaveAttribute("pressfeedback");
});
it("preserves hook-owned DOM feedback through parent rerender and clears lifecycle boundaries", () => {
  const view = render(<Button pressFeedback="attribute">Revision 1</Button>);
  const button = screen.getByRole("button");
  down(button);
  view.rerender(<Button pressFeedback="attribute">Revision 2</Button>);
  expect(button).toHaveAttribute("data-pressed", "true");
  up();
  expect(button).not.toHaveAttribute("data-pressed");
  down(button);
  view.rerender(
    <Button pressFeedback="attribute" disabled>
      Revision 2
    </Button>,
  );
  expect(button).not.toHaveAttribute("data-pressed");
  view.rerender(<Button pressFeedback="attribute">Revision 2</Button>);
  down(button);
  fireEvent.blur(button);
  expect(button).not.toHaveAttribute("data-pressed");
  down(button);
  view.unmount();
  expect(button).not.toHaveAttribute("data-pressed");
});
it("retains release activation and keyboard/assistive semantics", () => {
  const action = vi.fn();
  render(
    <Button pressFeedback="attribute" onClick={action}>
      Action
    </Button>,
  );
  const button = screen.getByRole("button");
  down(button);
  expect(action).not.toHaveBeenCalled();
  up();
  expect(action).not.toHaveBeenCalled();
  fireEvent.click(button, { detail: 1, button: 0 });
  expect(action).toHaveBeenCalledTimes(1);
  // JSDOM does not synthesize native keyboard click: supply that event explicitly.
  for (const key of ["Enter", " "]) {
    fireEvent.keyDown(button, { key });
    expect(button).toHaveAttribute("data-pressed", "true");
    fireEvent.keyUp(button, { key });
    expect(button).not.toHaveAttribute("data-pressed");
    fireEvent.click(button, { detail: 0 });
  }
  fireEvent.click(button, { detail: 0 });
  expect(action).toHaveBeenCalledTimes(4);
});
