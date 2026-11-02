import { runHeaderBackOverride } from "~/lib/header-back-events";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DrawingArcMenu,
  DrawingArcRegistration,
  useDrawingArcGesture,
  type DrawingArcGroup,
} from "./DrawingArcMenu";
import { DrawingSheetViewer } from "./DrawingSheetViewer";
import { useState } from "react";
import type { DrawingEntity } from "~/lib/drawing-workspace";

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
  useDrawingArcGesture("canvas", claim);
  return (
    <div data-drawing-arc-canvas data-testid="canvas" tabIndex={0}>
      <button>Existing control</button>
      <span role="button" data-annotation-id="markup" tabIndex={0}>
        Markup
      </span>
      <span>Drawing</span>
    </div>
  );
}
const canvas = () => screen.getByTestId("canvas");
const wheel = () => document.querySelector<HTMLElement>("[data-arc-scroller]");
const dwell = (ms = 700): void => {
  void act(() => {
    vi.advanceTimersByTime(ms);
  });
};
function aim(label: string) {
  const choice = wheel()!.querySelector<HTMLElement>(`[data-arc-choice][aria-label="${label}"]`);
  expect(choice, `arc choice ${label}`).not.toBeNull();
  fireEvent.click(choice!);
}
function open(group: DrawingArcGroup, claim?: () => void, enabled = true) {
  return render(
    <DrawingArcMenu enabled={enabled} group={group}>
      <Canvas claim={claim} />
    </DrawingArcMenu>,
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

describe("drawing arc menu", () => {
  it("closes an open arc when leaving fullscreen without remounting the drawing", () => {
    const group = { id: "drawing", title: "Sheet", items: [{ id: "fit", label: "Fit" }] };
    const view = render(<DrawingArcMenu enabled resetKey={true} group={group}><Canvas /></DrawingArcMenu>);
    const drawing = canvas();
    fireEvent.contextMenu(drawing, {button: 2, clientX: 200, clientY: 400});
    expect(wheel()).not.toBeNull();
    view.rerender(<DrawingArcMenu enabled={false} allowItemHold resetKey={false} group={group}><Canvas /></DrawingArcMenu>);
    expect(wheel()).toBeNull();
    expect(canvas()).toBe(drawing);
    // Fullscreen can be opened again; the old arc does not reappear.
    view.rerender(<DrawingArcMenu enabled resetKey={true} group={group}><Canvas /></DrawingArcMenu>);
    expect(wheel()).toBeNull();
  });
  it("borrows the arc menu for an annotation hold and restores regular controls after selection or dismissal", () => {
    const action = vi.fn(), changed = vi.fn();
    function RegularDrawing() {
      const [temporary, setTemporary] = useState(false);
      const [selected, setSelected] = useState(false);
      return <DrawingArcMenu enabled={temporary} allowItemHold
        onTemporaryChange={value => { changed(value); setTemporary(value); }}
        group={{ id: "drawing", title: "Sheet", items: [{ id: "fit", label: "Fit" }] }}>
        <DrawingArcRegistration group={selected ? {
          id: "selected", title: "Saved dimension", priority: 50,
          items: [{ id: "edit", label: "Edit dimension", run: action }],
        } : null} />
        <Canvas claim={() => setSelected(true)} />
        {!temporary && <span>Regular toolbar</span>}
      </DrawingArcMenu>;
    }
    render(<RegularDrawing />);
    fireEvent.pointerDown(canvas(), pointer);
    dwell();
    expect(wheel()).toBeNull();
    fireEvent.pointerUp(window, pointer);
    const target = screen.getByRole("button", { name: "Markup" });
    // A normal tap or a pan never changes modes.
    fireEvent.pointerDown(target, pointer);
    dwell(100);
    fireEvent.pointerUp(window, pointer);
    fireEvent.pointerDown(target, pointer);
    fireEvent.pointerMove(window, { ...pointer, clientX: 230 });
    dwell();
    fireEvent.pointerUp(window, pointer);
    expect(changed).not.toHaveBeenCalled();
    fireEvent.pointerDown(target, pointer);
    dwell();
    expect(wheel()).toHaveAttribute("aria-label", "Saved dimension");
    expect(screen.queryByText("Regular toolbar")).toBeNull();
    aim("Edit dimension");
    dwell();
    expect(action).toHaveBeenCalledOnce();
    expect(wheel()).toBeNull();
    expect(screen.getByText("Regular toolbar")).toBeVisible();
    fireEvent.pointerUp(window, pointer);
    fireEvent.pointerDown(target, pointer);
    dwell();
    expect(wheel()).not.toBeNull();
    fireEvent.pointerUp(window, pointer);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(wheel()).toBeNull();
    expect(changed.mock.calls).toEqual([[true], [false], [true], [false]]);
    expect(localStorage.getItem("foremanhq:drawing-quick-wheel:tim")).toBeNull();
  });

  it.each(["rect", "dimension", "text", "link"] as const)("opens temporary controls on a real %s without editing or activating it", type => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    HTMLElement.prototype.setPointerCapture = () => undefined;
    HTMLElement.prototype.releasePointerCapture = () => undefined;
    const save = vi.fn(), activate = vi.fn(), select = vi.fn();
    const entity: DrawingEntity = {
      id: "item", sheetId: "sheet", kind: "markup", revision: 1,
      visibility: "published", authorId: "user", authorName: "Tim",
      createdAt: "", updatedAt: "", comments: [],
      data: { sourceSheetId: "sheet", type, text: "Note",
        points: [{ x: .25, y: .25 }, { x: .5, y: .5 }], stroke: "#ef4444", width: 2 },
    };
    function Drawing() {
      const [temporary, setTemporary] = useState(false);
      const [selected, setSelected] = useState<string | null>(null);
      return <DrawingArcMenu enabled={temporary} allowItemHold onTemporaryChange={setTemporary}
        group={{ id: "drawing", title: "Sheet", items: [{ id: "fit", label: "Fit" }] }}>
        <DrawingArcRegistration group={selected ? { id: "item", title: "Selected item", priority: 50,
          items: [{ id: "style", label: "Style" }] } : null} />
        <DrawingSheetViewer src="/sheet.webp" alt="Sheet" sheetKey="sheet" tool="select"
          annotations={[entity]} selectedId={selected} onUpdate={save} onActivate={activate}
          onSelect={select} onQuickWheelSelect={setSelected} />
      </DrawingArcMenu>;
    }
    render(<Drawing />);
    const image = screen.getByAltText("Sheet");
    const frame = screen.getByRole("region", { name: "Sheet viewer" });
    Object.defineProperties(image, { naturalWidth: { value: 1000 }, naturalHeight: { value: 1000 } });
    Object.defineProperties(frame, { clientWidth: { value: 400 }, clientHeight: { value: 700 } });
    fireEvent.load(image);
    fireEvent.pointerDown(frame.querySelector('[data-annotation-id="item"]')!, pointer);
    if (type === "text") expect(select).not.toHaveBeenCalled();
    dwell();
    expect(wheel()).toHaveAttribute("aria-label", "Selected item");
    // The arc stays up after the lift so a choice can be tapped.
    fireEvent.pointerUp(window, pointer);
    expect(wheel()).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(wheel()).toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

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
        <DrawingArcMenu
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
        </DrawingArcMenu>
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
    expect(wheel()).toHaveAttribute("aria-label", "Measure");
    expect(save).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerDown(frame, pointer);
    dwell();
    expect(wheel()).not.toBeNull();
    fireEvent.pointerUp(frame, pointer);
    fireEvent.click(frame);
    expect(wheel()).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
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

  it("opens on right-click, stays open after mouse release, and steps into nested actions", async () => {
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
            children: [{ id: "select", label: "Edit Mode", run }],
          },
        ],
      },
      claim,
    );
    fireEvent.contextMenu(canvas(), { button: 2, clientX: 200, clientY: 400 });
    expect(claim).toHaveBeenCalledOnce();
    expect(wheel()).toHaveAttribute("aria-label", "A101");
    expect(screen.queryByRole("button", { name: "Back one step" })).toBeNull();
    fireEvent.pointerUp(canvas(), {
      ...pointer,
      pointerType: "mouse",
      button: 2,
    });
    expect(wheel()).not.toBeNull();
    aim("Tools");
    expect(wheel()).toHaveAttribute("aria-label", "Tools");
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Back one step" }));
    expect(wheel()).toHaveAttribute("aria-label", "A101");
    aim("Tools");
    aim("Edit Mode");
    expect(run).toHaveBeenCalledOnce();
    expect(wheel()).toBeNull();
  });

  it("waits for a touch long press, then consumes the lift even after a leaf action dismisses the arc", () => {
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
      <DrawingArcMenu enabled group={group}>
        <div onPointerUp={release} onClick={click}>
          <Canvas claim={claim} />
        </div>
      </DrawingArcMenu>,
    );
    fireEvent.pointerDown(canvas(), pointer);
    dwell(699);
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

  it("guards the initiating lift when a page action unmounts the arc", () => {
    const release = vi.fn(),
      click = vi.fn();
    function Pages() {
      const [next, setNext] = useState(false);
      return next ? (
        <button onPointerUp={release} onClick={click}>
          Next page
        </button>
      ) : (
        <DrawingArcMenu
          enabled
          group={{
            id: "drawing",
            title: "A101",
            items: [{ id: "next", label: "Next", run: () => setNext(true) }],
          }}
        >
          <Canvas />
        </DrawingArcMenu>
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

  it("stays open after the lift, cancels an interrupted hold, and closes on escape or resize", () => {
    const run = vi.fn();
    open({
      id: "drawing",
      title: "A101",
      items: [{ id: "one", label: "Measure", run }],
    });
    fireEvent.pointerDown(canvas(), pointer);
    dwell();
    fireEvent.pointerMove(window, { ...pointer, clientX: 210 });
    fireEvent.pointerUp(canvas(), pointer);
    dwell(1500);
    expect(run).not.toHaveBeenCalled();
    expect(wheel()).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(wheel()).toBeNull();
    fireEvent.pointerDown(canvas(), pointer);
    fireEvent.pointerCancel(canvas(), pointer);
    dwell();
    expect(wheel()).toBeNull();
    fireEvent.contextMenu(canvas(), { button: 2, clientX: 200, clientY: 400 });
    fireEvent.click(wheel()!);
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
          children: [{ id: "select", label: "Edit Mode", run }],
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
    fireEvent.click(screen.getByRole("button", { name: "Edit Mode" }));
    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uses current contextual actions without reopening the arc", () => {
    const group = {
      id: "drawing",
      title: "A101",
      items: [{ id: "more", label: "More" }],
    };
    const run = vi.fn();
    const view = render(
      <DrawingArcMenu enabled group={group}>
        <Canvas />
        <DrawingArcRegistration
          group={{
            id: "measurement",
            title: "Measure",
            priority: 30,
            items: [{ id: "undo", label: "Undo", disabled: true, run }],
          }}
        />
      </DrawingArcMenu>,
    );
    fireEvent.contextMenu(canvas(), { button: 2, clientX: 200, clientY: 400 });
    expect(wheel()).toHaveAttribute("aria-label", "Measure");
    view.rerender(
      <DrawingArcMenu enabled group={group}>
        <Canvas />
        <DrawingArcRegistration
          group={{
            id: "measurement",
            title: "Measure",
            priority: 30,
            items: [{ id: "undo", label: "Undo", run }],
          }}
        />
      </DrawingArcMenu>,
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


});


it("dismisses an open arc before back can reach the drawing", () => {
  open({ id: "drawing", title: "A101", items: [{ id: "measure", label: "Measure" }] });
  fireEvent.contextMenu(canvas(), {button: 2, clientX: 200, clientY: 400});
  expect(wheel()).not.toBeNull();
  act(() => { expect(runHeaderBackOverride()).toBe(true); });
  expect(wheel()).toBeNull();
  expect(runHeaderBackOverride()).toBe(false);
});
