import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TutorialOverlay } from "./TutorialOverlay";
import { placeTutorialCard } from "./tutorial-guide";

const rect = {
  left: 30,
  top: 220,
  width: 300,
  height: 70,
  right: 330,
  bottom: 290,
  x: 30,
  y: 220,
  toJSON: () => ({}),
};
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
      unobserve() {
        return undefined;
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return { ...rect, height: this.tagName === "ASIDE" ? 190 : rect.height };
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("guidance on real controls", () => {
  it("highlights an exact picker choice and guards pointer-up/context-menu actions elsewhere", async () => {
    const select = vi.fn(),
      other = vi.fn();
    render(
      <>
        <div data-tutorial="add-part-dialog" data-tutorial-stage="size">
          <div data-tutorial="wizard-size">
            <button
              data-tutorial-choice="All"
              onPointerUp={other}
              onContextMenu={other}
            >
              All sizes
            </button>
            <button data-tutorial-choice="2 in" onPointerUp={select}>
              2 in
            </button>
          </div>
        </div>
        <TutorialOverlay onFinish={vi.fn()} />
      </>,
    );
    await screen.findByText("Select the size");
    fireEvent.pointerUp(screen.getByText("All sizes"));
    fireEvent.contextMenu(screen.getByText("All sizes"));
    expect(other).not.toHaveBeenCalled();
    fireEvent.pointerUp(screen.getByText("2 in"));
    expect(select).toHaveBeenCalledOnce();
  });

  it("collapses guidance while typing in a short mobile viewport and keeps End accessible", async () => {
    const viewport = Object.assign(new EventTarget(), {
      width: 360,
      height: 300,
      offsetLeft: 0,
      offsetTop: 0,
    });
    vi.stubGlobal("visualViewport", viewport);
    render(
      <>
        <div data-tutorial="material-items" />
        <div data-tutorial="room-details">
          <textarea aria-label="Room notes" data-tutorial="room-notes" />
        </div>
        <TutorialOverlay onFinish={vi.fn()} />
      </>,
    );
    await screen.findByText("Next: Chat");
    await act(async () => {
      screen.getByLabelText("Room notes").focus();
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(screen.queryByText("Next: Chat")).not.toBeInTheDocument();
    expect(screen.getByText("End tutorial")).toBeVisible();
  });

  it("allows the real highlighted action and blocks unrelated controls", async () => {
    const select = vi.fn(),
      unrelated = vi.fn(),
      finish = vi.fn();
    render(
      <>
        <button data-tutorial="job-card" onClick={select}>
          Existing job card
        </button>
        <button onClick={unrelated}>Delete real job</button>
        <TutorialOverlay onFinish={finish} />
      </>,
    );
    expect(await screen.findByText("Select your job")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Delete real job"));
    expect(unrelated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Existing job card"));
    expect(select).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("End tutorial"));
    expect(finish).toHaveBeenCalledWith("skipped");
  });

  it("follows actual picker state and confirms an item exists before moving to Rooms", async () => {
    const finish = vi.fn();
    const view = render(
      <>
        <div
          data-tutorial="add-part-dialog"
          data-tutorial-stage="part"
          data-tutorial-pending-count="0"
        >
          <button data-tutorial="wizard-part">Fitting</button>
          <button data-tutorial="wizard-review-button">Review</button>
        </div>
        <TutorialOverlay onFinish={finish} />
      </>,
    );
    expect(await screen.findByText("Select a part")).toBeInTheDocument();
    await act(async () => {
      document
        .querySelector('[data-tutorial="add-part-dialog"]')
        ?.setAttribute("data-tutorial-pending-count", "1");
    });
    expect(
      await screen.findByText("Review your selected parts"),
    ).toBeInTheDocument();
    view.rerender(
      <>
        <div data-tutorial="material-items">Actual added part</div>
        <button data-tutorial="back">Back</button>
        <TutorialOverlay onFinish={finish} />
      </>,
    );
    expect(await screen.findByText("Back to your job")).toBeInTheDocument();
    expect(screen.getByText("Rooms · 2 of 3")).toBeInTheDocument();
  });

  it("keeps End inside the real modal focus boundary", async () => {
    render(
      <>
        <div data-slot="dialog-content" data-state="open" role="dialog">
          <div data-tutorial="add-part-dialog" data-tutorial-stage="catalog">
            <button data-tutorial="wizard-catalog">Plumbing</button>
          </div>
        </div>
        <TutorialOverlay onFinish={vi.fn()} />
      </>,
    );
    const end = await screen.findByText("End tutorial");
    expect(screen.getByRole("dialog")).toContainElement(end);
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(screen.getByText("Plumbing")).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(end).toHaveFocus();
  });

  it("keeps an early exit available while real content is loading", async () => {
    const finish = vi.fn();
    render(<TutorialOverlay onFinish={finish} />);
    fireEvent.click(await screen.findByText("End tutorial"));
    expect(finish).toHaveBeenCalledWith("skipped");
  });

  it("allows typing and sending in the actual composer and waits for the sent message", async () => {
    const finish = vi.fn();
    const view = render(
      <>
        <div>
          <div data-tutorial="material-items" />
          <div data-tutorial="room-details">
            <textarea data-tutorial="room-notes" />
          </div>
        </div>
        <TutorialOverlay onFinish={finish} />
      </>,
    );
    fireEvent.click(await screen.findByText("Next: Chat"));
    view.rerender(
      <>
        <div data-tutorial="chat-view">
          <textarea data-tutorial="chat-composer" aria-label="Message" />
          <button data-tutorial="chat-send">Send</button>
        </div>
        <TutorialOverlay onFinish={finish} />
      </>,
    );
    expect(
      await screen.findByText("Send a practice message"),
    ).toBeInTheDocument();
    fireEvent.input(screen.getByLabelText("Message"), {
      target: { value: "Hello" },
    });
    expect(screen.queryByText("Finish tutorial")).not.toBeInTheDocument();
    view.rerender(
      <>
        <div data-tutorial="chat-view">
          <p data-tutorial="chat-own-message">Hello</p>
        </div>
        <TutorialOverlay onFinish={finish} />
      </>,
    );
    fireEvent.click(await screen.findByText("Finish tutorial"));
    expect(finish).toHaveBeenCalledWith("completed");
  });
});

it.each([
  { left: 0, top: 0, width: 360, height: 640 },
  { left: 8, top: 8, width: 344, height: 360 },
  { left: 0, top: 280, width: 360, height: 260 },
  { left: 300, top: 50, width: 900, height: 650 },
])("keeps guidance inside mobile, keyboard and modal bounds: %j", (bounds) => {
  const placed = placeTutorialCard(
    { left: bounds.left + 10, top: bounds.top + 30, width: 100, height: 40 },
    bounds,
    190,
  );
  expect(placed.left).toBeGreaterThanOrEqual(bounds.left);
  expect(placed.left + placed.width).toBeLessThanOrEqual(
    bounds.left + bounds.width,
  );
  expect(placed.top).toBeGreaterThanOrEqual(bounds.top);
  expect(placed.top + 190).toBeLessThanOrEqual(bounds.top + bounds.height);
});
