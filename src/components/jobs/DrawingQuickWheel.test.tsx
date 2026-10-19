import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DrawingQuickWheel,
  DrawingWheelRegistration,
  useDrawingWheelGesture,
  type DrawingWheelGroup,
} from "./DrawingQuickWheel";
import {
  DrawingQuickWheelSetting,
  useDrawingQuickWheelMode,
} from "./useDrawingQuickWheelMode";
import { DrawingSheetViewer } from "./DrawingSheetViewer";
import { useState } from "react";

const identity = vi.hoisted(() => ({ key: "tim" }));
vi.mock("./DrawingAccountProvider", () => ({
  useDrawingAccount: () => ({ accountKey: identity.key }),
}));
const bounds = {
  x: 0,
  y: 80,
  left: 0,
  top: 80,
  right: 400,
  bottom: 780,
  width: 400,
  height: 700,
  toJSON() {
    return {};
  },
};
const pointer = {
  pointerId: 7,
  pointerType: "touch",
  isPrimary: true,
  button: 0,
  clientX: 200,
  clientY: 400,
};
function Canvas({ claim = () => undefined }: { claim?: () => void }) {
  useDrawingWheelGesture("canvas", claim);
  return (
    <div data-drawing-wheel-canvas data-testid="canvas" tabIndex={0}>
      <button>Existing control</button>
      <span role="button" data-annotation-id="markup" tabIndex={0}>
        Markup
      </span>
      <span>Drawing</span>
    </div>
  );
}
const canvas = () => screen.getByTestId("canvas");
const wheel = () => document.querySelector<HTMLElement>("[data-quick-wheel]");
const dwell = (ms = 500): void => {
  void act(() => {
    vi.advanceTimersByTime(ms);
  });
};
function aim(label: string) {
  const current = wheel()!;
  const tiles = [...current.querySelectorAll("foreignObject")];
  const tile = tiles.find((item) => item.textContent === label)!;
  expect(tile, `wheel choice ${label}`).toBeDefined();
  let x =
    Number(tile.getAttribute("x")) + Number(tile.getAttribute("width")) / 2;
  let y =
    Number(tile.getAttribute("y")) + Number(tile.getAttribute("height")) / 2;
  if (current.dataset.layout === "circle") {
    x += Number(current.dataset.originX) - 170;
    y += Number(current.dataset.originY) - 170;
  }
  fireEvent.pointerMove(window, { ...pointer, clientX: x, clientY: y });
}
function open(group: DrawingWheelGroup, claim?: () => void, enabled = true) {
  return render(
    <DrawingQuickWheel enabled={enabled} group={group}>
      <Canvas claim={claim} />
    </DrawingQuickWheel>,
  );
}
beforeEach(() => {
  identity.key = "tim";
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    bounds,
  );
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("drawing Quickwheel", () => {
  it("opens over accessible markup targets while leaving ordinary buttons alone", () => {
    open({
      id: "drawing",
      title: "A101",
      items: [{ id: "measure", label: "Measure" }],
    });
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Existing control" }),
      { button: 2 },
    );
    expect(wheel()).toBeNull();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Markup" }), {
      button: 2,
      clientX: 200,
      clientY: 400,
    });
    expect(wheel()).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Markup" }),
      pointer,
    );
    dwell();
    expect(wheel()).not.toBeNull();
    fireEvent.pointerUp(window, pointer);
  });

  it("keeps a real measured run intact when right-clicked or long-pressed, and prevents a stray point on lift", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {
          return undefined;
        }
        disconnect() {
          return undefined;
        }
      },
    );
    HTMLElement.prototype.setPointerCapture = () => undefined;
    HTMLElement.prototype.releasePointerCapture = () => undefined;
    const save = vi.fn();
    function Drawing() {
      const [mode, setMode] = useState({
        id: 0,
        mode: "idle" as "idle" | "measure",
      });
      return (
        <DrawingQuickWheel
          enabled
          group={{
            id: "drawing",
            title: "A101",
            items: [
              {
                id: "measure",
                label: "Measure",
                run: () => setMode({ id: 1, mode: "measure" }),
              },
            ],
          }}
        >
          <DrawingSheetViewer
            src="/sheet.webp"
            alt="Sheet"
            sheetKey="test"
            sharedScale={{ unit: "m", unitsPerSheetWidth: 100 }}
            onCreate={save}
            toolControls={{
              measureRequest: 0,
              pipeRequest: 0,
              modeRequest: mode,
            }}
          />
        </DrawingQuickWheel>
      );
    }
    render(<Drawing />);
    const image = screen.getByAltText("Sheet");
    const frame = screen.getByRole("region", { name: "Sheet viewer" });
    Object.defineProperties(image, {
      naturalWidth: { value: 1000 },
      naturalHeight: { value: 1000 },
    });
    Object.defineProperties(frame, {
      clientWidth: { value: 400 },
      clientHeight: { value: 700 },
    });
    fireEvent.load(image);
    fireEvent.keyDown(frame, { key: "ContextMenu" });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    expect(screen.queryByLabelText("Drawing tool options")).toBeNull();
    const tap = (x: number, y: number) => {
      fireEvent.pointerDown(frame, { ...pointer, clientX: x, clientY: y });
      fireEvent.pointerUp(frame, { ...pointer, clientX: x, clientY: y });
    };
    tap(100, 350);
    tap(300, 350);
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(2);
    fireEvent.contextMenu(frame, { button: 2, clientX: 200, clientY: 400 });
    expect(wheel()).toHaveAttribute("aria-label", "Measure quick wheel");
    expect(save).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerDown(frame, pointer);
    dwell();
    expect(wheel()).not.toBeNull();
    fireEvent.pointerUp(frame, pointer);
    fireEvent.click(frame);
    expect(wheel()).toBeNull();
    expect(frame.querySelectorAll("[data-measure-node]")).toHaveLength(2);
    expect(save).not.toHaveBeenCalled();
    fireEvent.keyDown(frame, { key: "ContextMenu" });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]![0]).toMatchObject({
      type: "dimension",
      parents: [null, 0],
    });
  });

  it("opens on right-click, stays open after mouse release, and confirms a nested action only after its dwell", async () => {
    const run = vi.fn(),
      claim = vi.fn();
    open(
      {
        id: "drawing",
        title: "A101",
        items: [
          {
            id: "tools",
            label: "Tools",
            children: [{ id: "select", label: "Select", run }],
          },
        ],
      },
      claim,
    );
    fireEvent.contextMenu(canvas(), { button: 2, clientX: 200, clientY: 400 });
    expect(claim).toHaveBeenCalledOnce();
    expect(wheel()).toHaveAttribute("aria-label", "A101 quick wheel");
    expect(document.querySelector("[data-quick-wheel-back]")).toBeNull();
    fireEvent.pointerUp(canvas(), {
      ...pointer,
      pointerType: "mouse",
      button: 2,
    });
    expect(wheel()).not.toBeNull();
    aim("Tools");
    dwell(499);
    expect(wheel()).toHaveAttribute("aria-label", "A101 quick wheel");
    dwell(1);
    expect(wheel()).toHaveAttribute("aria-label", "Tools quick wheel");
    expect(run).not.toHaveBeenCalled();
    aim("Select");
    dwell(499);
    expect(run).not.toHaveBeenCalled();
    dwell(1);
    expect(run).toHaveBeenCalledOnce();
    expect(wheel()).toBeNull();
  });

  it("waits for a touch long press, then consumes the lift even after a leaf action dismisses the wheel", () => {
    const run = vi.fn(),
      release = vi.fn(),
      click = vi.fn(),
      claim = vi.fn();
    const group = {
      id: "drawing",
      title: "A101",
      items: [{ id: "measure", label: "Measure", run }],
    };
    render(
      <DrawingQuickWheel enabled group={group}>
        <div onPointerUp={release} onClick={click}>
          <Canvas claim={claim} />
        </div>
      </DrawingQuickWheel>,
    );
    fireEvent.pointerDown(canvas(), pointer);
    dwell(499);
    expect(wheel()).toBeNull();
    expect(claim).not.toHaveBeenCalled();
    dwell(1);
    expect(wheel()).not.toBeNull();
    expect(claim).toHaveBeenCalledOnce();
    aim("Measure");
    dwell();
    expect(run).toHaveBeenCalledOnce();
    expect(wheel()).toBeNull();
    fireEvent.pointerUp(canvas(), pointer);
    fireEvent.click(canvas());
    expect(release).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    fireEvent.pointerDown(canvas(), pointer);
    fireEvent.pointerUp(canvas(), pointer);
    fireEvent.click(canvas());
    expect(release).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
  });

  it("guards the initiating lift when a page action unmounts the wheel", () => {
    const release = vi.fn(),
      click = vi.fn();
    function Pages() {
      const [next, setNext] = useState(false);
      return next ? (
        <button onPointerUp={release} onClick={click}>
          Next page
        </button>
      ) : (
        <DrawingQuickWheel
          enabled
          group={{
            id: "drawing",
            title: "A101",
            items: [{ id: "next", label: "Next", run: () => setNext(true) }],
          }}
        >
          <Canvas />
        </DrawingQuickWheel>
      );
    }
    render(<Pages />);
    fireEvent.pointerDown(canvas(), pointer);
    dwell();
    aim("Next");
    dwell();
    const page = screen.getByRole("button", { name: "Next page" });
    fireEvent.pointerUp(page, pointer);
    fireEvent.click(page);
    expect(release).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    fireEvent.pointerDown(page, pointer);
    fireEvent.pointerUp(page, pointer);
    fireEvent.click(page);
    expect(release).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
  });

  it("leaves quick taps, pans, and two-finger gestures to the canvas", () => {
    const claim = vi.fn();
    open(
      {
        id: "drawing",
        title: "A101",
        items: [{ id: "measure", label: "Measure" }],
      },
      claim,
    );
    fireEvent.pointerDown(canvas(), pointer);
    dwell(200);
    fireEvent.pointerUp(canvas(), pointer);
    dwell();
    expect(wheel()).toBeNull();
    fireEvent.pointerDown(canvas(), pointer);
    fireEvent.pointerMove(canvas(), { ...pointer, clientX: 220 });
    dwell();
    expect(wheel()).toBeNull();
    fireEvent.pointerDown(canvas(), pointer);
    fireEvent.pointerDown(canvas(), {
      ...pointer,
      isPrimary: false,
      pointerId: 8,
    });
    dwell();
    expect(wheel()).toBeNull();
    expect(claim).not.toHaveBeenCalled();
  });

  it("cancels when released, cancelled, resized, or escaped and keeps the center inactive", () => {
    const run = vi.fn();
    open({
      id: "drawing",
      title: "A101",
      items: [{ id: "one", label: "Measure", run }],
    });
    fireEvent.pointerDown(canvas(), pointer);
    dwell();
    fireEvent.pointerMove(window, { ...pointer, clientX: 210 });
    dwell(1500);
    expect(run).not.toHaveBeenCalled();
    fireEvent.pointerUp(canvas(), pointer);
    expect(wheel()).toBeNull();
    fireEvent.pointerDown(canvas(), pointer);
    fireEvent.pointerCancel(canvas(), pointer);
    dwell();
    expect(wheel()).toBeNull();
    fireEvent.contextMenu(canvas(), { button: 2, clientX: 200, clientY: 400 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(wheel()).toBeNull();
    fireEvent.contextMenu(canvas(), { button: 2, clientX: 200, clientY: 400 });
    fireEvent.resize(window);
    expect(wheel()).toBeNull();
  });

  it("keeps disabled choices inactive and supports keyboard access to the same actions", () => {
    const run = vi.fn();
    open({
      id: "drawing",
      title: "A101",
      items: [
        { id: "undo", label: "Undo", disabled: true, run },
        {
          id: "tools",
          label: "Tools",
          children: [{ id: "select", label: "Select", run }],
        },
      ],
    });
    fireEvent.contextMenu(canvas(), { button: 2, clientX: 200, clientY: 400 });
    aim("Undo");
    dwell(1000);
    expect(run).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(canvas(), { key: "F10", shiftKey: true });
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uses current contextual actions without reopening the wheel", () => {
    const group = {
      id: "drawing",
      title: "A101",
      items: [{ id: "more", label: "More" }],
    };
    const run = vi.fn();
    const view = render(
      <DrawingQuickWheel enabled group={group}>
        <Canvas />
        <DrawingWheelRegistration
          group={{
            id: "measurement",
            title: "Measure",
            priority: 30,
            items: [{ id: "undo", label: "Undo", disabled: true, run }],
          }}
        />
      </DrawingQuickWheel>,
    );
    fireEvent.contextMenu(canvas(), { button: 2, clientX: 200, clientY: 400 });
    expect(wheel()).toHaveAttribute("aria-label", "Measure quick wheel");
    view.rerender(
      <DrawingQuickWheel enabled group={group}>
        <Canvas />
        <DrawingWheelRegistration
          group={{
            id: "measurement",
            title: "Measure",
            priority: 30,
            items: [{ id: "undo", label: "Undo", run }],
          }}
        />
      </DrawingQuickWheel>,
    );
    aim("Undo");
    dwell();
    expect(run).toHaveBeenCalledOnce();
  });

  it("leaves the existing context menu and touch behavior alone when disabled", () => {
    const claim = vi.fn();
    open(
      {
        id: "drawing",
        title: "A101",
        items: [{ id: "measure", label: "Measure" }],
      },
      claim,
      false,
    );
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
    });
    canvas().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    fireEvent.pointerDown(canvas(), pointer);
    dwell(1000);
    expect(wheel()).toBeNull();
    expect(claim).not.toHaveBeenCalled();
  });

  it("remembers the optional mode separately for each account", () => {
    function Setting() {
      const { enabled } = useDrawingQuickWheelMode();
      return (
        <>
          <DrawingQuickWheelSetting />
          <output>{enabled ? "wheel" : "bars"}</output>
        </>
      );
    }
    const view = render(<Setting />);
    expect(
      screen.getByRole("switch", { name: "Quickwheel mode" }),
    ).not.toBeChecked();
    fireEvent.click(screen.getByRole("switch", { name: "Quickwheel mode" }));
    expect(screen.getByText("wheel")).toBeInTheDocument();
    identity.key = "chris";
    view.rerender(<Setting />);
    expect(screen.getByText("bars")).toBeInTheDocument();
    identity.key = "tim";
    view.rerender(<Setting />);
    expect(screen.getByText("wheel")).toBeInTheDocument();
    view.unmount();
    render(<Setting />);
    expect(
      screen.getByRole("switch", { name: "Quickwheel mode" }),
    ).toBeChecked();
  });
});
