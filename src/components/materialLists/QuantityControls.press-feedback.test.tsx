import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { QuantityControls } from "./QuantityControls";
const { save } = vi.hoisted(() => ({
  save: vi.fn<
    (input: {
      itemId: string;
      materialListId: string;
      quantity: number;
    }) => Promise<void>
  >(),
}));
vi.mock("~/hooks/use-workspace-mutations", () => ({
  useWorkspaceMutations: () => ({ saveQuantity: save }),
}));
vi.mock("~/lib/performance-marks", () => ({ markUserAction: vi.fn() }));
vi.mock("~/lib/speed-telemetry", () => ({
  startSpeedPaint: () => () => undefined,
}));
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
beforeEach(() => { save.mockReset().mockResolvedValue(undefined); });
afterEach(cleanup);
afterAll(() => vi.unstubAllGlobals());
const down = (node: Element) =>
  fireEvent.pointerDown(node, {
    pointerId: 1,
    isPrimary: true,
    button: 0,
    clientX: 10,
    clientY: 10,
  });
const up = () =>
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 10 });
const click = (node: Element) =>
  fireEvent.click(node, { detail: 1, button: 0 });
const props = { itemId: "item", materialListId: "list", quantity: 2 };
describe.each(["horizontal", "vertical"] as const)(
  "%s quantity attribute feedback",
  (orientation) => {
    it("writes exactly once on each release click, with immediate local value before acknowledgement", async () => {
      const accepted: Array<() => void> = [];
      save.mockImplementation(
        () => new Promise<void>((resolve) => accepted.push(resolve)),
      );
      render(<QuantityControls {...props} orientation={orientation} />);
      const plus = screen.getByLabelText("Increase quantity"),
        minus = screen.getByLabelText("Decrease quantity");
      down(plus);
      expect(plus).toHaveAttribute("data-pressed", "true");
      expect(save).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Quantity")).toHaveValue("2");
      up();
      expect(plus).not.toHaveAttribute("data-pressed");
      expect(save).not.toHaveBeenCalled();
      click(plus);
      expect(screen.getByLabelText("Quantity")).toHaveValue("3");
      expect(save).toHaveBeenCalledExactlyOnceWith({
        itemId: "item",
        materialListId: "list",
        quantity: 3,
      });
      down(minus);
      up();
      expect(save).toHaveBeenCalledTimes(1);
      click(minus);
      expect(screen.getByLabelText("Quantity")).toHaveValue("2");
      expect(save.mock.calls.map(([x]) => x.quantity)).toEqual([3, 2]);
      await act(async () => {
        for (const finish of accepted) finish();
      });
    });
    it("keeps the disabled minimum and rejects canceled/moved/scrolled/outside release", async () => {
      const view = render(
        <>
          <QuantityControls {...props} quantity={1} orientation={orientation} />
          <div data-testid="outside">Outside</div>
        </>,
      );
      const minus = screen.getByLabelText("Decrease quantity"),
        plus = screen.getByLabelText("Increase quantity");
      expect(minus).toBeDisabled();
      down(minus);
      up();
      click(minus);
      expect(save).not.toHaveBeenCalled();
      expect(minus).not.toHaveAttribute("data-pressed");
      for (const cancel of [
        () => fireEvent.pointerCancel(window, { pointerId: 1 }),
        () =>
          fireEvent.pointerMove(window, {
            pointerId: 1,
            clientX: 40,
            clientY: 10,
          }),
        () => fireEvent.scroll(window),
        () =>
          fireEvent.pointerUp(screen.getByTestId("outside"), { pointerId: 1 }),
      ]) {
        down(plus);
        cancel();
        up();
        click(plus);
        expect(plus).not.toHaveAttribute("data-pressed");
        expect(save).not.toHaveBeenCalled();
        expect(screen.getByLabelText("Quantity")).toHaveValue("1");
      }
      view.unmount();
      await act(async () => {
        await Promise.resolve();
      });
    });
  },
);
