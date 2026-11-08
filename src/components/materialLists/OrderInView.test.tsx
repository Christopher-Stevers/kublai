import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRef } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useOrderInView } from "./use-order-in-view";
import {
  MaterialListActions,
  OrderReceiveActions,
} from "./MaterialListActions";

vi.mock("~/trpc/react", () => ({ api: {} }));
vi.mock("~/components/materialLists/prefabs/SaveAsPrefabDialog", () => ({
  SaveAsPrefabDialog: () => null,
}));

type Span = { top: number; bottom: number };
let spans: Record<string, Span> = {};

beforeEach(() => {
  spans = {};
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const id = this.dataset.sectionHeading;
      const { top, bottom } = (id === undefined ? undefined : spans[id]) ?? {
        top: 0,
        bottom: 800,
      };
      return {
        top,
        bottom,
        left: 0,
        right: 400,
        width: 400,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness({ headings, sectionFocus = false }: { headings: string[]; sectionFocus?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useOrderInView(ref, headings.join("|"), true, sectionFocus ? "data-material-section" : "data-section-heading");
  return (
    <>
      <div ref={ref} data-testid="list">
        <div>
          {headings.map((id) => (
            <div key={id} data-section-heading={id} data-material-section={id || "not-ordered"}>
              {id || "Not ordered"}
            </div>
          ))}
        </div>
      </div>
      <p>On screen: {active ?? "none"}</p>
    </>
  );
}

// Heading tops; the list shows 0 to 800, so the line sits at 240.
const at = (top: number) => ({ top, bottom: top + 20 });
const scrollTo = (next: Record<string, Span>) => {
  spans = next;
  fireEvent.scroll(screen.getByTestId("list"));
};
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

it("swaps to an order once its heading scrolls up past the line", async () => {
  spans = { "": at(0), a: at(500), b: at(1400) };
  render(<Harness headings={["", "a", "b"]} />);
  await frame();
  expect(screen.getByText("On screen: none")).toBeInTheDocument();

  // In view but still below the line: the list's own bar stays.
  scrollTo({ "": at(-200), a: at(300), b: at(1200) });
  await frame();
  expect(screen.getByText("On screen: none")).toBeInTheDocument();

  scrollTo({ "": at(-300), a: at(200), b: at(1100) });
  await screen.findByText("On screen: a");

  // Long after its heading has gone off the top, it is still that order.
  scrollTo({ "": at(-1000), a: at(-500), b: at(400) });
  await frame();
  expect(screen.getByText("On screen: a")).toBeInTheDocument();

  scrollTo({ "": at(-1300), a: at(-800), b: at(100) });
  await screen.findByText("On screen: b");

  scrollTo({ "": at(-100), a: at(400), b: at(1300) });
  await screen.findByText("On screen: none");
});

it("lets a short last order take over at the end of the list", async () => {
  spans = { "": at(-900), a: at(600) };
  render(<Harness headings={["", "a"]} />);
  const list = screen.getByTestId("list");
  Object.defineProperties(list, {
    scrollTop: { configurable: true, value: 900 },
    clientHeight: { configurable: true, value: 800 },
    scrollHeight: { configurable: true, value: 1700 },
  });
  scrollTo({ "": at(-900), a: at(600) });
  await screen.findByText("On screen: a");
});

const listBar = (orderActive: boolean) => (
  <MaterialListActions
    total={12}
    canGenerate
    canOrder
    canAdd
    onQuote={vi.fn()}
    onOrder={vi.fn()}
    onAdd={vi.fn()}
    orderActive={orderActive}
    orderActions={
      <OrderReceiveActions
        label={<span>Receiving PO-7</span>}
        onNotes={onNotes}
        packingSlips={<button>Packing slips</button>}
        onMarkAllReceived={onMarkAllReceived}
        onMarkNoneReceived={onMarkNoneReceived}
      />
    }
  />
);
const onNotes = vi.fn();
const onMarkAllReceived = vi.fn();
const onMarkNoneReceived = vi.fn();

it("shows one bar at a time, the order's in place of the list's", () => {
  const { rerender } = render(listBar(false));
  expect(screen.getByRole("button", { name: /Add Part/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Order/ })).toBeInTheDocument();
  expect(
    screen.queryByRole("group", { name: "Receive order" }),
  ).not.toBeInTheDocument();

  rerender(listBar(true));
  const bar = screen.getByRole("group", { name: "Receive order" });
  expect(bar).toHaveTextContent("Receiving PO-7");
  expect(
    screen.queryByRole("button", { name: /Add Part/ }),
  ).not.toBeInTheDocument();
  // The list's bar is still there, sliding away, but cannot be used.
  expect(screen.getByText("Add Part").closest("[inert]")).not.toBeNull();
  // Four receiving actions: the lowest waits on the shelf.
  fireEvent.click(within(bar).getByRole("button", { name: /Expand all actions|Collapse actions/ }));
  fireEvent.click(screen.getByRole("button", { name: /Mark all received/ }));
  fireEvent.click(screen.getByRole("button", { name: /Notes/ }));
  fireEvent.click(within(bar).getByRole("button", { name: /Expand all actions/ }));
  fireEvent.click(screen.getByRole("button", { name: /Mark none received/ }));
  expect(onMarkAllReceived).toHaveBeenCalledTimes(1);
  expect(onNotes).toHaveBeenCalledTimes(1);
  expect(onMarkNoneReceived).toHaveBeenCalledTimes(1);
});

it("keeps the verify page's bar on its own", () => {
  render(
    <MaterialListActions
      total={12}
      totalOrderLabel="Receiving 184-Next"
      canGenerate
    canOrder
    canAdd
      onQuote={vi.fn()}
      onOrder={vi.fn()}
      onAdd={vi.fn()}
      onNotes={vi.fn()}
      onMarkAllReceived={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("button", { name: /Mark all received/ }),
  ).toBeEnabled();
  expect(
    screen.getByRole("button", { name: /Add Part/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("group", { name: "Receive order" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Material Total")).toBeInTheDocument();
  expect(screen.getByText("$12.00")).toBeInTheDocument();
});

it("tracks the pending section as well as each order and returns when scrolling back", async () => {
  spans = { "": at(0), a: at(500), b: at(1400) };
  render(<Harness headings={["", "a", "b"]} sectionFocus />);
  await screen.findByText("On screen: not-ordered");
  scrollTo({ "": at(-300), a: at(200), b: at(1100) });
  await screen.findByText("On screen: a");
  scrollTo({ "": at(-1300), a: at(-800), b: at(100) });
  await screen.findByText("On screen: b");
  scrollTo({ "": at(0), a: at(500), b: at(1400) });
  await screen.findByText("On screen: not-ordered");
});
