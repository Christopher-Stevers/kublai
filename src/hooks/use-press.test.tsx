import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { PressableCard } from "~/components/ui/pressable-card";

beforeAll(() => {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    isPrimary: boolean;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.isPrimary = init.isPrimary ?? true;
      this.pointerType = init.pointerType ?? "touch";
    }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});
afterEach(cleanup);
const down = (node: Element, props = {}) =>
  fireEvent.pointerDown(node, {
    pointerId: 1,
    isPrimary: true,
    button: 0,
    clientX: 10,
    clientY: 10,
    ...props,
  });
const up = () =>
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 10 });
const pointerClick = (node: Element, props = {}) =>
  fireEvent.click(node, { button: 0, detail: 1, ...props });

describe("reviewed press modes", () => {
  it("acts on fixed pointer down, paints pressed state, and swallows its click", () => {
    const write = vi.fn();
    render(
      <Button press="fixed" onClick={write}>
        Tool
      </Button>,
    );
    const button = screen.getByRole("button");
    down(button);
    expect(write).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("data-pressed", "true");
    up();
    pointerClick(button);
    expect(write).toHaveBeenCalledTimes(1);
    expect(button).not.toHaveAttribute("data-pressed");
  });
  it("blocks the compatibility click when fixed navigation replaces its own control", () => {
    const next = vi.fn();
    function Changing() {
      const [opened, setOpened] = useState(false);
      return opened ? (
        <Button onClick={next}>Next</Button>
      ) : (
        <Button press="fixed" onClick={() => setOpened(true)}>
          Open
        </Button>
      );
    }
    render(<Changing />);
    down(screen.getByText("Open"));
    up();
    pointerClick(screen.getByText("Next"));
    expect(next).not.toHaveBeenCalled();
  });
  it("default and destructive writes stay on release, once per pointer activation", () => {
    const send = vi.fn(),
      remove = vi.fn();
    render(
      <>
        <Button onClick={send}>Send order</Button>
        <Button press="fixed" variant="destructive" onClick={remove}>
          Delete
        </Button>
      </>,
    );
    for (const [label, action] of [
      ["Send order", send],
      ["Delete", remove],
    ] as const) {
      const button = screen.getByText(label);
      down(button);
      expect(action).not.toHaveBeenCalled();
      up();
      pointerClick(button);
      expect(action).toHaveBeenCalledTimes(1);
    }
  });
  it("prepares rows on down and activates only after a valid release", () => {
    const open = vi.fn(),
      prepare = vi.fn();
    render(
      <PressableCard
        role="button"
        tabIndex={0}
        onClick={open}
        prepare={prepare}
      >
        Job
      </PressableCard>,
    );
    const row = screen.getByRole("button");
    down(row);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    up();
    pointerClick(row);
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("200 scrolling flings never open a row and cancel each preparation", () => {
    const open = vi.fn(),
      signals: AbortSignal[] = [];
    render(
      <PressableCard
        role="button"
        tabIndex={0}
        onClick={open}
        prepare={(signal) => signals.push(signal)}
      >
        Job
      </PressableCard>,
    );
    const row = screen.getByRole("button");
    for (let i = 0; i < 200; i++) {
      down(row);
      fireEvent.pointerMove(window, {
        pointerId: 1,
        clientX: 10,
        clientY: 70 + i,
      });
      fireEvent.scroll(window);
      up();
      pointerClick(row);
    }
    expect(open).not.toHaveBeenCalled();
    expect(signals).toHaveLength(200);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
  it("scroll without motion and pointercancel independently cancel a row", () => {
    const open = vi.fn(),
      signals: AbortSignal[] = [];
    render(
      <PressableCard
        role="button"
        onClick={open}
        prepare={(s) => signals.push(s)}
      >
        Job
      </PressableCard>,
    );
    const row = screen.getByRole("button");
    down(row);
    fireEvent.scroll(window);
    up();
    pointerClick(row);
    down(row);
    fireEvent.pointerCancel(window, { pointerId: 1 });
    pointerClick(row);
    expect(open).not.toHaveBeenCalled();
    expect(signals.every((s) => s.aborted)).toBe(true);
  });
  it("keyboard and screen-reader clicks use the normal click path", () => {
    const action = vi.fn();
    render(
      <Button press="fixed" onClick={action}>
        Tool
      </Button>,
    );
    const button = screen.getByRole("button");
    fireEvent.keyDown(button, { key: "Enter" });
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(button, { detail: 0 });
    fireEvent.keyUp(button, { key: "Enter" });
    fireEvent.click(button, { detail: 0 });
    expect(action).toHaveBeenCalledTimes(2);
  });
  it("focusable cards retain Enter and Space activation", () => {
    const action = vi.fn();
    render(
      <PressableCard role="button" tabIndex={0} onClick={action}>
        Job
      </PressableCard>,
    );
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("button"), { key: " " });
    expect(action).toHaveBeenCalledTimes(2);
  });
  it("ignores auxiliary, modified, secondary and disabled pointer presses", () => {
    const action = vi.fn();
    const view = render(
      <Button press="fixed" onClick={action}>
        Tool
      </Button>,
    );
    const button = screen.getByRole("button");
    for (const props of [
      { button: 1 },
      { button: 2 },
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { isPrimary: false },
    ])
      down(button, props);
    expect(action).not.toHaveBeenCalled();
    view.rerender(
      <Button disabled press="fixed" onClick={action}>
        Tool
      </Button>,
    );
    down(screen.getByRole("button"));
    pointerClick(screen.getByRole("button"));
    expect(action).not.toHaveBeenCalled();
  });
  it("nested controls never prepare or open the scroll row", () => {
    const open = vi.fn(),
      prepare = vi.fn(),
      menu = vi.fn();
    render(
      <PressableCard role="button" onClick={open} prepare={prepare}>
        Job<Button onClick={menu}>Menu</Button>
      </PressableCard>,
    );
    const nested = screen.getByText("Menu");
    down(nested);
    up();
    pointerClick(nested);
    expect(menu).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });
});
