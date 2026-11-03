import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppKeyboardNavigation, resetKeyboardHistory } from "./AppKeyboardNavigation";
import { useHeaderBackOverride } from "~/lib/header-back-events";

const router = vi.hoisted(() => ({ back: vi.fn(), forward: vi.fn(), push: vi.fn() }));
const nav = vi.hoisted(() => ({ pathname: "/jobs" }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

// Items are laid out by their data-box: "left top width height".
function layout() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const [left = 0, top = 0, width = 0, height = 0] = (this.dataset.box ?? "").split(" ").map(Number);
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} };
  });
}
const at = (url: string) => {
  window.history.replaceState(null, "", url);
  nav.pathname = url;
};

beforeEach(() => {
  vi.clearAllMocks();
  resetKeyboardHistory();
  at("/jobs");
  layout();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const tapW = () => {
  fireEvent.keyDown(window, { key: "w" });
  fireEvent.keyUp(window, { key: "w" });
};

function Back({ up }: { up: () => void }) {
  useHeaderBackOverride(up, { historyGuard: false });
  return null;
}

function Grid({ onPick = vi.fn(), onMenu = vi.fn() }: { onPick?: (name: string) => void; onMenu?: (name: string) => void }) {
  return (
    <>
      <AppKeyboardNavigation />
      <main>
        <button data-box="0 0 100 50" onClick={() => onPick("one")} onContextMenu={() => onMenu("one")}>One</button>
        <button data-box="120 0 100 50" onClick={() => onPick("two")}>Two</button>
        <button data-box="0 70 100 50" onClick={() => onPick("three")}>Three</button>
        <a href="#four" data-box="120 70 100 50" onClick={(event) => { event.preventDefault(); onPick("four"); }}>Four</a>
      </main>
    </>
  );
}

it("moves between the page's items with the arrow keys, and W clicks the one chosen", () => {
  const pick = vi.fn();
  render(<Grid onPick={pick} />);
  fireEvent.keyDown(window, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByText("One"));
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(document.activeElement).toBe(screen.getByText("Two"));
  fireEvent.keyDown(window, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByText("Four"));
  expect(document.activeElement).toHaveAttribute("data-key-focus");
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(screen.getByText("Three"));
  // Nothing further left: focus stays.
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(screen.getByText("Three"));
  tapW();
  expect(pick).toHaveBeenCalledWith("three");
  fireEvent.keyDown(window, { key: "ArrowRight" });
  tapW();
  expect(pick).toHaveBeenLastCalledWith("four");
  expect(pick).toHaveBeenCalledTimes(2);
});

it("does not count a wider item above as being to the right", () => {
  render(
    <>
      <AppKeyboardNavigation />
      <button data-box="0 0 400 40">Wide</button>
      <button data-box="0 60 20 20">Tick</button>
    </>,
  );
  fireEvent.keyDown(window, { key: "ArrowDown" });
  fireEvent.keyDown(window, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByText("Tick"));
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(document.activeElement).toBe(screen.getByText("Tick"));
});

it("moves past a dropdown with the arrows, and opens it only with W", () => {
  const opened = vi.fn();
  render(
    <>
      <AppKeyboardNavigation />
      <button
        role="combobox"
        data-box="0 0 200 40"
        onKeyDown={(event) => event.key === "ArrowDown" && opened("key")}
        onPointerDown={() => opened("press")}
      >
        Supplier
      </button>
      <button data-box="0 60 200 40">Save</button>
      <span role="button" tabIndex={0} data-own-arrows="" data-box="0 120 20 20" data-testid="handle" />
    </>,
  );
  fireEvent.keyDown(window, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByText("Supplier"));
  fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByText("Save"));
  expect(opened).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
  fireEvent.keyDown(document.activeElement!, { key: "w" });
  expect(opened).toHaveBeenCalledWith("press");
  // A control that moves with the arrows itself keeps them.
  act(() => screen.getByTestId("handle").focus());
  fireEvent.keyDown(screen.getByTestId("handle"), { key: "ArrowUp" });
  expect(document.activeElement).toBe(screen.getByTestId("handle"));
});

it("holding W is a long press: the item's hold timer runs until W comes up", () => {
  vi.useFakeTimers();
  const events = vi.fn();
  function Held() {
    const timer = { current: undefined as ReturnType<typeof setTimeout> | undefined };
    let long = false;
    return (
      <button
        data-box="0 0 100 40"
        onPointerDown={() => {
          long = false;
          timer.current = setTimeout(() => { long = true; events("long press"); }, 500);
        }}
        onPointerUp={() => clearTimeout(timer.current)}
        onClick={() => events(long ? "click after hold" : "click")}
      >
        Card
      </button>
    );
  }
  render(<><AppKeyboardNavigation /><Held /></>);
  fireEvent.keyDown(window, { key: "ArrowDown" });
  tapW();
  expect(events.mock.calls).toEqual([["click"]]);
  events.mockClear();
  fireEvent.keyDown(window, { key: "w" });
  // The keyboard repeats while held; that must not press again.
  for (let i = 0; i < 10; i++) {
    act(() => { vi.advanceTimersByTime(60); });
    fireEvent.keyDown(window, { key: "w", repeat: true });
  }
  expect(events.mock.calls).toEqual([["long press"]]);
  fireEvent.keyUp(window, { key: "w" });
  expect(events.mock.calls).toEqual([["long press"], ["click after hold"]]);
  vi.useRealTimers();
});

it("focuses the middle of a new screen opened from the keyboard", () => {
  vi.useFakeTimers();
  function App() {
    const [page, setPage] = useState("list");
    return (
      <>
        <AppKeyboardNavigation />
        <header><button data-box="0 0 40 40">Menu</button></header>
        {page === "list" ? (
          <button data-box="0 100 100 40" onClick={() => { at("/jobs/job"); setPage("job"); }}>Open job</button>
        ) : (
          <main>
            <button data-box="20 100 100 40">Top</button>
            <button data-box="440 360 140 40">Middle</button>
            <button data-box="20 700 100 40">Bottom</button>
          </main>
        )}
      </>
    );
  }
  render(<App />);
  fireEvent.keyDown(window, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByText("Open job"));
  tapW();
  act(() => { vi.advanceTimersByTime(500); });
  expect(document.activeElement).toBe(screen.getByText("Middle"));
  expect(document.activeElement).toHaveAttribute("data-key-focus");
  vi.useRealTimers();
});

it("leaves focus alone when the screen does not change, or the mouse takes over", () => {
  vi.useFakeTimers();
  render(
    <>
      <Grid />
      <button data-box="440 360 140 40">Middle</button>
    </>,
  );
  fireEvent.keyDown(window, { key: "ArrowDown" });
  tapW();
  act(() => { vi.advanceTimersByTime(4000); });
  expect(document.activeElement).toBe(screen.getByText("One"));
  vi.useRealTimers();
});

it("right-clicks the chosen item with S", () => {
  const menu = vi.fn();
  render(<Grid onMenu={menu} />);
  fireEvent.keyDown(window, { key: "ArrowDown" });
  fireEvent.keyDown(window, { key: "s" });
  expect(menu).toHaveBeenCalledWith("one");
});

it("A is the back arrow, and D returns to the page it left", () => {
  const up = vi.fn(() => at("/jobs/job"));
  at("/jobs/job/drawings");
  const view = render(<><AppKeyboardNavigation /><Back up={up} /></>);
  fireEvent.keyDown(window, { key: "a" });
  expect(up).toHaveBeenCalledOnce();
  view.rerender(<><AppKeyboardNavigation /><Back up={up} /></>);
  fireEvent.keyDown(window, { key: "d" });
  expect(router.push).toHaveBeenCalledWith("/jobs/job/drawings");
  at("/jobs/job/drawings");
  view.rerender(<><AppKeyboardNavigation /><Back up={up} /></>);
  // Nothing left to go forward to here.
  fireEvent.keyDown(window, { key: "d" });
  expect(router.push).toHaveBeenCalledOnce();
  expect(router.forward).toHaveBeenCalledOnce();
});

it("forgets the forward pages once you go somewhere new", () => {
  const up = vi.fn(() => at("/jobs/job"));
  at("/jobs/job/drawings");
  const view = render(<><AppKeyboardNavigation /><Back up={up} /></>);
  fireEvent.keyDown(window, { key: "a" });
  view.rerender(<><AppKeyboardNavigation /><Back up={up} /></>);
  at("/jobs/job/rooms");
  view.rerender(<><AppKeyboardNavigation /><Back up={up} /></>);
  fireEvent.keyDown(window, { key: "d" });
  expect(router.push).not.toHaveBeenCalled();
});

it("closes a dialog with A and keeps the arrows inside it", () => {
  const close = vi.fn();
  const up = vi.fn();
  render(
    <>
      <Grid />
      <Back up={up} />
      <div role="dialog" onKeyDown={(event) => event.key === "Escape" && close()}>
        <button data-box="300 300 80 40">Save</button>
      </div>
    </>,
  );
  fireEvent.keyDown(window, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByText("Save"));
  fireEvent.keyDown(window, { key: "a" });
  expect(close).toHaveBeenCalledOnce();
  expect(up).not.toHaveBeenCalled();
});

it("leaves typing, modifiers, held keys and open menus alone", () => {
  const up = vi.fn();
  const view = render(
    <>
      <Grid />
      <Back up={up} />
      <input aria-label="Message" data-box="0 200 200 30" />
      <div contentEditable suppressContentEditableWarning data-testid="editor">Note</div>
    </>,
  );
  for (const target of [screen.getByLabelText("Message"), screen.getByTestId("editor")])
    for (const key of ["a", "w", "ArrowDown"]) fireEvent.keyDown(target, { key });
  for (const option of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }, { isComposing: true }, { repeat: true }])
    fireEvent.keyDown(window, { key: "a", ...option });
  expect(up).not.toHaveBeenCalled();
  expect(document.activeElement).not.toBe(screen.getByText("One"));
  view.rerender(
    <>
      <Grid />
      <Back up={up} />
      <div role="menu" data-state="open">Choices</div>
    </>,
  );
  fireEvent.keyDown(window, { key: "ArrowDown" });
  expect(up).not.toHaveBeenCalled();
  expect(document.activeElement).not.toBe(screen.getByText("One"));
});

it("picks the highlighted menu choice with W and closes the menu with A", () => {
  const keys = vi.fn();
  const up = vi.fn();
  render(
    <>
      <AppKeyboardNavigation />
      <Back up={up} />
      <div role="menu" data-state="open" onKeyDown={(event) => keys(event.key)}>
        <div role="menuitem" tabIndex={-1} data-testid="item">Rename</div>
      </div>
    </>,
  );
  act(() => screen.getByTestId("item").focus());
  fireEvent.keyDown(window, { key: "w" });
  fireEvent.keyDown(window, { key: "a" });
  expect(keys.mock.calls).toEqual([["Enter"], ["Escape"]]);
  expect(up).not.toHaveBeenCalled();
});

it("removes its listener when the app shell leaves", () => {
  const view = render(<Grid />);
  view.unmount();
  act(() => { fireEvent.keyDown(window, { key: "ArrowDown" }); });
  expect(document.activeElement).toBe(document.body);
});
