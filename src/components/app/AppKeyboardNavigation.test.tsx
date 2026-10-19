import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppKeyboardNavigation } from "./AppKeyboardNavigation";

const router = vi.hoisted(() => ({ back: vi.fn(), forward: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it("uses real back/forward navigation and leaves up/down scrolling alone", () => {
  render(<AppKeyboardNavigation />);
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  fireEvent.keyDown(window, { key: "ArrowRight" });
  fireEvent.keyDown(window, { key: "ArrowUp" });
  fireEvent.keyDown(window, { key: "ArrowDown" });
  expect(router.back).toHaveBeenCalledOnce();
  expect(router.forward).toHaveBeenCalledOnce();
});
it("leaves text editing and keyboard selectors alone", () => {
  render(
    <>
      <AppKeyboardNavigation />
      <input aria-label="Message" />
      <div contentEditable suppressContentEditableWarning data-testid="editor">
        Note
      </div>
      <div role="tablist">
        <button>Tab</button>
      </div>
    </>,
  );
  for (const target of [
    screen.getByLabelText("Message"),
    screen.getByTestId("editor"),
    screen.getByRole("button"),
  ]) {
    fireEvent.keyDown(target, { key: "ArrowLeft" });
    fireEvent.keyDown(target, { key: "ArrowRight" });
  }
  expect(router.back).not.toHaveBeenCalled();
  expect(router.forward).not.toHaveBeenCalled();
});
it("does not override modifiers, IME, handled events or a held navigation key", () => {
  render(<AppKeyboardNavigation />);
  for (const option of [
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { shiftKey: true },
    { isComposing: true },
    { repeat: true },
  ])
    fireEvent.keyDown(window, { key: "ArrowLeft", ...option });
  const event = new KeyboardEvent("keydown", {
    key: "ArrowLeft",
    cancelable: true,
  });
  event.preventDefault();
  window.dispatchEvent(event);
  expect(router.back).not.toHaveBeenCalled();
});
it("protects dialogs and open menus, but allows history within a document viewer", () => {
  const view = render(
    <>
      <AppKeyboardNavigation />
      <div role="dialog">Edit details</div>
    </>,
  );
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  expect(router.back).not.toHaveBeenCalled();
  view.rerender(
    <>
      <AppKeyboardNavigation />
      <div role="dialog">
        <div data-drawing-keyboard-surface />
      </div>
    </>,
  );
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  expect(router.back).toHaveBeenCalledOnce();
  view.rerender(
    <>
      <AppKeyboardNavigation />
      <div role="menu" data-state="open">
        Choices
      </div>
    </>,
  );
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(router.forward).not.toHaveBeenCalled();
});
it("removes its listener when the app shell leaves", () => {
  const view = render(<AppKeyboardNavigation />);
  view.unmount();
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  expect(router.back).not.toHaveBeenCalled();
});
