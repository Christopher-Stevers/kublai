import { Profiler, useState, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { usePress } from "./use-press";
import { PressableCard } from "~/components/ui/pressable-card";

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
const down = (node: Element, more: PointerEventInit = {}) => fireEvent.pointerDown(node, {
  pointerId: 1, isPrimary: true, button: 0, clientX: 10, clientY: 10, ...more,
});
const up = () => fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 10 });
const click = (node: Element) => fireEvent.click(node, { button: 0, detail: 1 });
function Probe({ disabled = false, fixed = false, action = () => undefined, children = "Probe" }: {
  disabled?: boolean; fixed?: boolean; action?: () => void; children?: ReactNode;
}) {
  const { pressProps } = usePress<HTMLButtonElement>({ feedback: "attribute", disabled, press: fixed ? "fixed" : "release", onClick: action });
  return <button {...pressProps} disabled={disabled}>{children}</button>;
}

describe("opt-in attribute-only press feedback", () => {
  it("paints down/up immediately without a React commit and keeps feedback through unrelated renders", () => {
    let commits = 0;
    const view = render(<Profiler id="press" onRender={() => commits++}><Probe /></Profiler>);
    const button = screen.getByRole("button");
    const initial = commits;
    down(button);
    expect(button).toHaveAttribute("data-pressed", "true");
    expect(commits).toBe(initial);
    view.rerender(<Profiler id="press" onRender={() => commits++}><Probe>Changed</Probe></Profiler>);
    expect(button).toHaveAttribute("data-pressed", "true");
    const afterParent = commits;
    up();
    expect(button).not.toHaveAttribute("data-pressed");
    expect(commits).toBe(afterParent);
    click(button);
    expect(commits).toBe(afterParent);
  });

  it("keeps the existing React-state mode as the default", () => {
    let commits = 0;
    render(<Profiler id="default" onRender={() => commits++}><PressableCard role="button">Default</PressableCard></Profiler>);
    const initial = commits, row = screen.getByRole("button");
    down(row);
    expect(row).toHaveAttribute("data-pressed", "true");
    expect(commits).toBeGreaterThan(initial);
    up();
    expect(row).not.toHaveAttribute("data-pressed");
  });

  it("200 flings abort preparation, clear feedback and never activate or commit React state", () => {
    let commits = 0;
    const action = vi.fn(), signals: AbortSignal[] = [];
    render(<Profiler id="flings" onRender={() => commits++}><PressableCard feedback="attribute" role="button" onClick={action} prepare={s => signals.push(s)}>Job</PressableCard></Profiler>);
    const row = screen.getByRole("button"), initial = commits;
    for (let i = 0; i < 200; i++) {
      down(row);
      expect(row).toHaveAttribute("data-pressed", "true");
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 30 + i });
      fireEvent.scroll(window);
      expect(row).not.toHaveAttribute("data-pressed");
      up(); click(row);
    }
    expect(action).not.toHaveBeenCalled();
    expect(signals).toHaveLength(200);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(commits).toBe(initial);
  });

  it("clears cancel/blur/disable/unmount and rejects cancelled release", () => {
    const action = vi.fn();
    const view = render(<Probe action={action} />);
    const button = screen.getByRole("button");
    down(button); fireEvent.pointerCancel(window, { pointerId: 1 }); click(button);
    expect(button).not.toHaveAttribute("data-pressed"); expect(action).not.toHaveBeenCalled();
    down(button); fireEvent.blur(button); click(button);
    expect(button).not.toHaveAttribute("data-pressed"); expect(action).not.toHaveBeenCalled();
    down(button); view.rerender(<Probe disabled action={action} />);
    expect(button).not.toHaveAttribute("data-pressed");
    view.rerender(<Probe action={action} />); down(button); view.unmount();
    expect(button).not.toHaveAttribute("data-pressed");
  });

  it("retains outside-release, nested-control and modified-pointer protections", () => {
    const action = vi.fn(), nested = vi.fn(), signals: AbortSignal[] = [];
    render(<><PressableCard feedback="attribute" role="button" onClick={action} prepare={s => signals.push(s)}>Job<button onClick={nested}>Menu</button></PressableCard><div data-testid="outside">Outside</div></>);
    const row = screen.getByRole("button", { name: "Job Menu" });
    down(row); fireEvent.pointerUp(screen.getByTestId("outside"), { pointerId: 1 }); click(row);
    expect(action).not.toHaveBeenCalled(); expect(row).not.toHaveAttribute("data-pressed");
    down(screen.getByRole("button", { name: "Menu" })); up(); click(screen.getByRole("button", { name: "Menu" }));
    expect(nested).toHaveBeenCalledOnce(); expect(action).not.toHaveBeenCalled();
    const count = signals.length;
    for (const more of [{ button: 2 }, { ctrlKey: true }, { isPrimary: false }]) down(row, more);
    expect(signals).toHaveLength(count); expect(row).not.toHaveAttribute("data-pressed");
  });

  it("retains release activation, fresh double clicks, Enter/Space and assistive clicks", () => {
    const action = vi.fn();
    render(<PressableCard feedback="attribute" role="button" tabIndex={0} onClick={action}>Job</PressableCard>);
    const row = screen.getByRole("button");
    for (let i = 0; i < 2; i++) { down(row); expect(action).toHaveBeenCalledTimes(i); up(); click(row); }
    fireEvent.keyDown(row, { key: "Enter" }); fireEvent.keyUp(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " }); fireEvent.keyUp(row, { key: " " });
    fireEvent.click(row, { detail: 0 });
    expect(action).toHaveBeenCalledTimes(5); expect(row).not.toHaveAttribute("data-pressed");
  });

  it("preserves the fixed compatibility guard even when its attributed control unmounts", () => {
    const next = vi.fn();
    function Changing() {
      const [opened, setOpened] = useState(false);
      return opened ? <button onClick={next}>Next</button> : <Probe fixed action={() => setOpened(true)}>Open</Probe>;
    }
    render(<Changing />);
    down(screen.getByText("Open")); up(); click(screen.getByText("Next"));
    expect(next).not.toHaveBeenCalled();
    down(screen.getByText("Next")); up(); click(screen.getByText("Next"));
    expect(next).toHaveBeenCalledOnce();
  });
});
