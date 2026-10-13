import { useState } from "react";
import { SizeStage, type SizeStageProps } from "./SizeStage";
import { formatSize } from "~/lib/size-utils";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickWheelSurface, useQuickWheelOptions } from "./QuickWheel";
import { wheelUsageId } from "./quick-wheel-usage";
const WHEEL_USAGE_KEY = "foremanhq:quick-wheel-usage:v1";
const readWheelUsage = () =>
  JSON.parse(localStorage.getItem(WHEEL_USAGE_KEY) ?? "{}");

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
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
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
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("wizard quick wheel", () => {
  it("keeps the frosted backdrop below the wizard header", () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      x: 0,
      y: 120,
      left: 0,
      top: 120,
      right: 400,
      bottom: 700,
      width: 400,
      height: 580,
      toJSON() {},
    });
    render(
      <QuickWheelSurface>
        <Stage select={vi.fn()} />
      </QuickWheelSurface>,
    );
    down();
    expect(wheel()!.querySelector(".quick-wheel-backdrop")).toHaveStyle({
      top: "120px",
    });
    // Full-circle label centres use the expanded ring, not the old 117-unit radius.
    const label = wheel()!.querySelector("foreignObject")!;
    const y =
      Number(label.getAttribute("y")) +
      Number(label.getAttribute("height")) / 2;
    expect(y).toBeCloseTo(170 - 138);
  });
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
    expect(wheel()).toHaveAttribute("data-origin-x", "200");
    expect(wheel()).toHaveAttribute("data-origin-y", "180");
    const choice = document.querySelector<HTMLElement>(
      '[data-wheel-choice="1"]',
    )!;
    const x =
      Number(choice.getAttribute("x")) +
      Number(choice.getAttribute("width")) / 2;
    const y =
      Number(choice.getAttribute("y")) +
      Number(choice.getAttribute("height")) / 2;
    aim(x, y);
    dwell();
    expect(select).toHaveBeenCalledTimes(2);
    expect(wheel()).toHaveAttribute("data-origin-x", String(x));
    expect(wheel()).toHaveAttribute("data-origin-y", String(y));
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
    expect(wheel()).toHaveAttribute("data-layout", "curved");
    expect(wheel()).toHaveAttribute("data-origin-x", "215");
    expect(wheel()).toHaveAttribute("data-origin-y", "40");
    aim(215, 40);
    dwell(1000);
    expect(select).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(window, pointer);
    expect(wheel()).toBeNull();
  });
  it("shows the curved dead zone and cancels a pending selection when returning to it", () => {
    const select = vi.fn();
    render(
      <QuickWheelSurface>
        <Stage select={select} />
      </QuickWheelSurface>,
    );
    fireEvent.pointerDown(screen.getByTestId("blank"), {
      ...pointer,
      clientX: 20,
      clientY: 300,
    });
    expect(document.querySelector("[data-wheel-dead-zone]")).toHaveAttribute(
      "r",
      "64",
    );
    const choice = document.querySelector('[data-wheel-choice="0"]')!;
    const x =
        Number(choice.getAttribute("x")) +
        Number(choice.getAttribute("width")) / 2,
      y =
        Number(choice.getAttribute("y")) +
        Number(choice.getAttribute("height")) / 2;
    aim(x, y);
    dwell(300);
    const length = Math.hypot(x - 20, y - 300);
    aim(20 + ((x - 20) * 50) / length, 300 + ((y - 300) * 50) / length);
    dwell(1000);
    expect(select).not.toHaveBeenCalled();
    aim(x, y);
    dwell();
    expect(select).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(window, pointer);
  });
  it("captures the stable surface and keeps selecting when the part stage replaces the starting target", () => {
    const capture = vi.fn(),
      release = vi.fn();
    const select = vi.fn();
    function Flow() {
      const [parts, setParts] = useState(false);
      return (
        <QuickWheelSurface data-testid="surface">
          {parts ? (
            <div key="parts">
              <Stage title="Add Part" select={select} />
            </div>
          ) : (
            <div key="categories">
              <Stage title="Category" select={() => setParts(true)} />
            </div>
          )}
        </QuickWheelSurface>
      );
    }
    render(<Flow />);
    const surface = screen.getByTestId("surface");
    Object.assign(surface, {
      setPointerCapture: capture,
      hasPointerCapture: () => true,
      releasePointerCapture: release,
    });
    const initial = screen.getByTestId("blank");
    down();
    expect(capture).toHaveBeenCalledWith(1);
    aim();
    dwell();
    expect(initial.isConnected).toBe(false);
    expect(wheel()).toHaveAttribute("aria-label", "Add Part quick wheel");
    const choose = () => {
      const choice = document.querySelector('[data-wheel-choice="0"]')!;
      aim(
        Number(choice.getAttribute("x")) +
          Number(choice.getAttribute("width")) / 2,
        Number(choice.getAttribute("y")) +
          Number(choice.getAttribute("height")) / 2,
      );
      dwell();
    };
    choose();
    expect(select).toHaveBeenCalledTimes(1);
    expect(wheel()).toBeInTheDocument();
    fireEvent.pointerUp(window, pointer);
    expect(release).toHaveBeenCalledWith(1);
    expect(wheel()).toBeNull();
  });
  it("ends immediately after choosing a category and does not open on later cards", () => {
    const select = vi.fn();
    function Flow() {
      const [stage, setStage] = useState("category");
      return (
        <QuickWheelSurface
          enabled={["catalog", "material", "size", "category"].includes(stage)}
        >
          <Stage
            title={stage}
            select={() => {
              select();
              setStage("part");
            }}
          />
        </QuickWheelSurface>
      );
    }
    render(<Flow />);
    down();
    aim();
    dwell();
    expect(select).toHaveBeenCalledTimes(1);
    expect(wheel()).toBeNull();
    aim();
    dwell();
    expect(select).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(window, pointer);
    down();
    expect(wheel()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Normal card" }));
    expect(select).toHaveBeenCalledTimes(2);
  });
  it("ignores old tap history and ranks only supplied order history", () => {
    localStorage.setItem(
      WHEEL_USAGE_KEY,
      JSON.stringify({ [wheelUsageId("Catalog", "Choice 2")]: 999 }),
    );
    render(
      <QuickWheelSurface usage={{ [wheelUsageId("Catalog", "Choice 1")]: 2 }}>
        <Stage select={vi.fn()} />
      </QuickWheelSurface>,
    );
    down();
    const labels = Array.from(wheel()!.querySelectorAll("foreignObject"));
    expect(labels[1]).toHaveTextContent("Choice 1");
  });
  it("places the most used choice toward screen centre and invokes the correct reordered action", () => {
    // Screen centre is below/right of this wheel; the nearest slot is lower-right.
    localStorage.setItem(
      WHEEL_USAGE_KEY,
      JSON.stringify({
        [wheelUsageId("Catalog", "Choice 2")]: 12,
        [wheelUsageId("Catalog", "Choice 1")]: 3,
      }),
    );
    const select = vi.fn();
    render(
      <QuickWheelSurface usage={readWheelUsage()}>
        <Stage select={select} />
      </QuickWheelSurface>,
    );
    down();
    const labels = Array.from(wheel()!.querySelectorAll("foreignObject"));
    expect(labels[1]).toHaveTextContent("Choice 2");
    aim(304, 360);
    dwell();
    expect(select).toHaveBeenCalledWith(2);
    expect(readWheelUsage()[wheelUsageId("Catalog", "Choice 2")]).toBe(12);
  });
  it("puts frequent choices on the first page and progressively less used choices behind More", () => {
    localStorage.setItem(
      WHEEL_USAGE_KEY,
      JSON.stringify(
        Object.fromEntries(
          Array.from({ length: 15 }, (_, index) => [
            wheelUsageId("Catalog", `Choice ${index}`),
            index + 1,
          ]),
        ),
      ),
    );
    render(
      <QuickWheelSurface usage={readWheelUsage()}>
        <Stage count={15} select={vi.fn()} />
      </QuickWheelSurface>,
    );
    down();
    const choices = () =>
      Array.from(wheel()!.querySelectorAll("foreignObject"))
        .map((label) => label.textContent)
        .filter((label) => label?.startsWith("Choice "))
        .sort();
    const more = () => {
      const root = wheel()!;
      const label = Array.from(root.querySelectorAll("foreignObject")).find(
        (entry) => entry.textContent?.startsWith("More"),
      )!;
      const circle = root.getAttribute("data-layout") === "circle";
      aim(
        Number(label.getAttribute("x")) +
          Number(label.getAttribute("width")) / 2 +
          (circle ? Number(root.getAttribute("data-origin-x")) - 170 : 0),
        Number(label.getAttribute("y")) +
          Number(label.getAttribute("height")) / 2 +
          (circle ? Number(root.getAttribute("data-origin-y")) - 170 : 0),
      );
      dwell();
    };
    expect(choices()).toEqual(
      [9, 10, 11, 12, 13, 14].map((n) => `Choice ${n}`).sort(),
    );
    more();
    expect(choices()).toEqual(
      [3, 4, 5, 6, 7, 8].map((n) => `Choice ${n}`).sort(),
    );
    more();
    expect(choices()).toEqual(["Choice 0", "Choice 1", "Choice 2"]);
  });
  it.each(["touch", "keyboard"])(
    "keeps real size-card %s selections working without influencing order ranking",
    (mode) => {
      const select = vi.fn();
      const noop = () => undefined;
      const props: SizeStageProps = {
        availableSizes: [{ nominal: 2, unit: "in", count: 1 }],
        selectedSize: null,
        onSizeSelect: select,
        showCustomSize: false,
        onShowCustomSize: noop,
        customSizeInput: "",
        onCustomSizeInputChange: noop,
        customSizeUnitId: null,
        onCustomSizeUnitIdChange: noop,
        allUnits: [],
        onCreateSize: { mutate: noop, isPending: false },
      };
      render(
        <QuickWheelSurface>
          <SizeStage {...props} />
        </QuickWheelSurface>,
      );
      const label = formatSize(2, "in");
      const card = screen.getByRole("button", { name: '2"' });
      Object.assign(card, { setPointerCapture: vi.fn() });
      if (mode === "touch") {
        fireEvent.pointerDown(card, { ...pointer, pointerType: "touch" });
        fireEvent.pointerUp(card, { ...pointer, pointerType: "touch" });
      } else fireEvent.keyDown(card, { key: "Enter" });
      expect(select).toHaveBeenCalledWith({
        nominal: 2,
        unit: "in",
        sizeLabel: null,
      });
      expect(
        readWheelUsage()[wheelUsageId("Select Size", label)],
      ).toBeUndefined();
      // A compatibility click must not count the same gesture a second time.
      fireEvent.click(card);
      expect(
        readWheelUsage()[wheelUsageId("Select Size", label)],
      ).toBeUndefined();
      fireEvent.pointerDown(screen.getByText("Select Size"), pointer);
      const labels = Array.from(wheel()!.querySelectorAll("foreignObject"));
      expect(labels.some((entry) => entry.textContent === label)).toBe(true);
    },
  );
  it("does not treat ordinary wizard card taps as ordered parts", () => {
    const select = vi.fn();
    function Cards() {
      const choose = useQuickWheelOptions("Material", [
        { label: "Copper", select },
      ]);
      return (
        <div className="wizard-option-grid">
          <button onClick={() => choose("Copper")}>Copper</button>
        </div>
      );
    }
    render(
      <QuickWheelSurface>
        <Cards />
      </QuickWheelSurface>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copper" }));
    expect(select).toHaveBeenCalledTimes(1);
    expect(
      readWheelUsage()[wheelUsageId("Material", "Copper")],
    ).toBeUndefined();
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
    expect(screen.getByText("Choice 6")).toBeInTheDocument();
    aim(115, 215);
    dwell(2000);
    expect(screen.getByText("Choice 6")).toBeInTheDocument();
    const choice = document.querySelector<HTMLElement>(
      '[data-wheel-choice="0"]',
    )!;
    aim(
      Number(choice.getAttribute("x")) +
        Number(choice.getAttribute("width")) / 2,
      Number(choice.getAttribute("y")) +
        Number(choice.getAttribute("height")) / 2,
    );
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
