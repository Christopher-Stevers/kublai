import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickWheelSurface, useQuickWheelOptions } from "./QuickWheel";

function Stage({
  title = "Catalog",
  count = 3,
  select,
}: {
  title?: string;
  count?: number;
  select: (index: number) => void;
}) {
  useQuickWheelOptions(
    title,
    Array.from({ length: count }, (_, index) => ({
      label: `Choice ${index}`,
      select: () => select(index),
    })),
  );
  return (
    <>
      <button onClick={() => select(99)}>Normal card</button>
      <input aria-label="Search" />
      <div data-testid="blank">Empty workspace</div>
    </>
  );
}
function Harness({ select }: { select: (index: number) => void }) {
  const [stage, setStage] = useState(0);
  return (
    <QuickWheelSurface>
      <Stage
        title={`Stage ${stage}`}
        select={(index) => {
          select(index);
          setStage(stage + 1);
        }}
      />
    </QuickWheelSurface>
  );
}
const pointer = {
  pointerId: 1,
  isPrimary: true,
  button: 0,
  clientX: 200,
  clientY: 300,
};
const down = () => fireEvent.pointerDown(screen.getByTestId("blank"), pointer);
const aim = (x = 200, y = 180) =>
  fireEvent.pointerMove(window, { ...pointer, clientX: x, clientY: y });
const dwell = (ms = 500) => act(() => vi.advanceTimersByTime(ms));
const wheel = () => screen.queryByRole("status");
beforeEach(() => {
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
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("wizard quick wheel", () => {
  it("selects after 500 ms and continues through stages without releasing", () => {
    const select = vi.fn();
    render(<Harness select={select} />);
    down();
    aim();
    dwell(499);
    expect(select).not.toHaveBeenCalled();
    dwell(1);
    expect(select).toHaveBeenCalledTimes(1);
    expect(wheel()).toHaveAttribute("aria-label", "Stage 1 quick wheel");
    aim();
    dwell(1000);
    expect(select).toHaveBeenCalledTimes(1);
    expect(wheel()?.firstElementChild).toHaveStyle({
      left: "30px",
      top: "10px",
    });
    aim(320, 180);
    dwell();
    expect(select).toHaveBeenCalledTimes(2);
    expect(wheel()?.firstElementChild).toHaveStyle({
      left: "150px",
      top: "10px",
    });
    fireEvent.pointerUp(window, pointer);
    expect(wheel()).not.toBeInTheDocument();
    expect(select).toHaveBeenCalledTimes(2);
  });
  it("recenters at the latest position within a highlighted sector, including near edges", () => {
    const select = vi.fn();
    render(
      <QuickWheelSurface>
        <Stage select={select} />
      </QuickWheelSurface>,
    );
    down();
    aim();
    dwell(300);
    aim(215, 40);
    dwell(200);
    expect(select).toHaveBeenCalledTimes(1);
    expect(wheel()?.firstElementChild).toHaveStyle({
      left: "45px",
      top: "-130px",
    });
    aim(215, 40);
    dwell(1000);
    expect(select).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(window, pointer);
    expect(wheel()).toBeNull();
  });
  it("cancels an early release or leaving the highlight without selecting", () => {
    const select = vi.fn();
    render(
      <QuickWheelSurface>
        <Stage select={select} />
      </QuickWheelSurface>,
    );
    down();
    aim();
    dwell(300);
    fireEvent.pointerUp(window, pointer);
    dwell();
    expect(select).not.toHaveBeenCalled();
    expect(wheel()).toBeNull();
    down();
    aim();
    dwell(300);
    aim(200, 300);
    dwell();
    expect(select).not.toHaveBeenCalled();
  });
  it("keeps normal cards, inputs and non-primary mouse buttons working", () => {
    const select = vi.fn();
    render(
      <QuickWheelSurface>
        <Stage select={select} />
      </QuickWheelSurface>,
    );
    fireEvent.pointerDown(screen.getByRole("button"), pointer);
    expect(wheel()).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(select).toHaveBeenCalledWith(99);
    fireEvent.pointerDown(screen.getByRole("textbox"), pointer);
    expect(wheel()).toBeNull();
    fireEvent.pointerDown(screen.getByTestId("blank"), {
      ...pointer,
      button: 2,
    });
    expect(wheel()).toBeNull();
  });
  it("browses off-page choices while held and does not keep paging when stationary", () => {
    const select = vi.fn();
    render(
      <QuickWheelSurface>
        <Stage count={15} select={select} />
      </QuickWheelSurface>,
    );
    down();
    aim(115, 215);
    dwell(); // sector 7: More
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    aim(115, 215);
    dwell(2000);
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    aim(115, 95);
    dwell();
    expect(select).toHaveBeenCalledWith(6);
    dwell(1000);
    expect(select).toHaveBeenCalledTimes(1);
  });
  it.each(["pointercancel", "blur", "resize"])(
    "cancels on %s with no delayed action",
    (event) => {
      const select = vi.fn();
      render(
        <QuickWheelSurface>
          <Stage select={select} />
        </QuickWheelSurface>,
      );
      down();
      aim();
      fireEvent(window, new Event(event));
      dwell();
      expect(select).not.toHaveBeenCalled();
      expect(wheel()).toBeNull();
    },
  );
  it("Escape dismisses while holding and disabling clears a pending gesture", () => {
    const select = vi.fn();
    const { rerender } = render(
      <QuickWheelSurface>
        <Stage select={select} />
      </QuickWheelSurface>,
    );
    down();
    aim();
    fireEvent.keyDown(window, { key: "Escape" });
    dwell();
    expect(wheel()).toBeNull();
    down();
    aim();
    rerender(
      <QuickWheelSurface enabled={false}>
        <Stage select={select} />
      </QuickWheelSurface>,
    );
    dwell();
    expect(wheel()).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });
  it("ignores a second pointer movement and cancels multi-touch", () => {
    const select = vi.fn();
    render(
      <QuickWheelSurface>
        <Stage select={select} />
      </QuickWheelSurface>,
    );
    down();
    fireEvent.pointerMove(window, { ...pointer, pointerId: 2, clientY: 180 });
    dwell();
    expect(select).not.toHaveBeenCalled();
    fireEvent.touchMove(window, {
      touches: [
        { clientX: 200, clientY: 200 },
        { clientX: 210, clientY: 210 },
      ],
    });
    expect(wheel()).toBeNull();
  });
});
