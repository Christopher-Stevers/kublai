import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRef } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
      const id = this.dataset.orderId;
      const { top, bottom } = (id ? spans[id] : undefined) ?? {
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

function Harness({ orders }: { orders: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useOrderInView(ref, orders.join("|"));
  return (
    <>
      <div ref={ref} data-testid="list">
        <div>
          {orders.map((id) => (
            <section key={id} data-order-id={id}>
              {id}
            </section>
          ))}
        </div>
      </div>
      <p>On screen: {active ?? "none"}</p>
    </>
  );
}

const scrollTo = (next: Record<string, Span>) => {
  spans = next;
  fireEvent.scroll(screen.getByTestId("list"));
};

it("follows the order taking up most of the screen", async () => {
  spans = { a: { top: 0, bottom: 500 }, b: { top: 500, bottom: 1200 } };
  render(<Harness orders={["a", "b"]} />);
  await screen.findByText("On screen: a");

  scrollTo({ a: { top: -400, bottom: 100 }, b: { top: 100, bottom: 800 } });
  await screen.findByText("On screen: b");

  scrollTo({ a: { top: -1400, bottom: -900 }, b: { top: -900, bottom: -200 } });
  await screen.findByText("On screen: none");
});

it("needs a fair bit on screen to show and only goes once fully off", async () => {
  spans = { a: { top: 760, bottom: 1200 } };
  render(<Harness orders={["a"]} />);
  await waitFor(() =>
    expect(screen.getByText("On screen: none")).toBeInTheDocument(),
  );

  scrollTo({ a: { top: 300, bottom: 740 } });
  await screen.findByText("On screen: a");

  // The bar it brings up covers most of it; it stays.
  scrollTo({ a: { top: 760, bottom: 1200 } });
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(screen.getByText("On screen: a")).toBeInTheDocument();

  scrollTo({ a: { top: 800, bottom: 1240 } });
  await screen.findByText("On screen: none");
});

it("adds the order's receiving bar above the list's own actions", () => {
  const onNotes = vi.fn();
  const onMarkAllReceived = vi.fn();
  const onMarkNoneReceived = vi.fn();
  render(
    <MaterialListActions
      total={12}
      canGenerate
      onQuote={vi.fn()}
      onOrder={vi.fn()}
      onAdd={vi.fn()}
      orderActions={
        <OrderReceiveActions
          label={<span>Receiving PO-7</span>}
          onNotes={onNotes}
          packingSlips={<button>Packing slips</button>}
          onMarkAllReceived={onMarkAllReceived}
          onMarkNoneReceived={onMarkNoneReceived}
        />
      }
    />,
  );
  const bar = screen.getByRole("group", { name: "Receive order" });
  expect(bar).toHaveTextContent("Receiving PO-7");
  fireEvent.click(screen.getByRole("button", { name: /Mark all received/ }));
  fireEvent.click(screen.getByRole("button", { name: /Notes/ }));
  fireEvent.click(screen.getByRole("button", { name: /Mark none received/ }));
  expect(onMarkAllReceived).toHaveBeenCalledTimes(1);
  expect(onNotes).toHaveBeenCalledTimes(1);
  expect(onMarkNoneReceived).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: /Add Part/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Order/ })).toBeInTheDocument();
});

it("keeps the verify page's bar on its own", () => {
  render(
    <MaterialListActions
      total={12}
      canGenerate
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
    screen.queryByRole("button", { name: /Add Part/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("group", { name: "Receive order" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Material Total")).not.toBeInTheDocument();
});
