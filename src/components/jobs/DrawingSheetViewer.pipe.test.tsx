import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrawingSheetViewer } from "./DrawingSheetViewer";
import type { DrawingEntity } from "~/lib/drawing-workspace";
import type { PipeLinework, PipeSegment } from "~/lib/pipe-system";
import { formatLengthAs } from "~/lib/sheet-measure";

const { loadPipeLinework } = vi.hoisted(() => ({
  loadPipeLinework:
    vi.fn<(source: { url: string; page: number }) => Promise<PipeLinework>>(),
}));
vi.mock("~/lib/pdf-pipe-lines", () => ({ loadPipeLinework }));
vi.mock("~/lib/pdf-snap-lines", () => ({
  loadSnapLines: vi.fn().mockResolvedValue([]),
}));
vi.mock("./DrawingComparisonLayer", () => ({
  DrawingComparisonLayer: () => null,
}));
vi.mock("./DrawingPdfLayer", () => ({ DrawingPdfLayer: () => null }));

const sheetKey = "031060be-2d10-4c21-bda2-dd1619a1e280";
const pdf = { url: "/pipe-drawing.pdf", page: 1 };
function line(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): PipeSegment {
  return {
    id,
    pathId: id,
    x1,
    y1,
    x2,
    y2,
    stroke: "#000000",
    width: 0.002,
    dash: [0.008, 0.004],
  };
}
const linework: PipeLinework = {
  aspect: 0.5,
  truncated: false,
  segments: [
    line("trunk-left", 0.1, 0.5, 0.45, 0.5),
    line("trunk-right", 0.5, 0.5, 0.9, 0.5),
    line("branch-up", 0.3, 0.5, 0.3, 0.2),
    line("branch-down", 0.7, 0.5, 0.7, 0.8),
    line("detached", 0.1, 0.9, 0.3, 0.9),
    { ...line("SAN-crossing", 0.6, 0.1, 0.6, 0.9), dash: [], width: 0.0015 },
  ],
  labels: [
    {
      text: "ST",
      system: "ST",
      left: 0.45,
      right: 0.5,
      top: 0.485,
      bottom: 0.515,
    },
    {
      text: "ST",
      system: "ST",
      left: 0.15,
      right: 0.18,
      top: 0.875,
      bottom: 0.895,
    },
    {
      text: "SAN",
      system: "SAN",
      left: 0.61,
      right: 0.65,
      top: 0.72,
      bottom: 0.75,
    },
  ],
};
const entity: DrawingEntity = {
  id: "markup",
  sheetId: sheetKey,
  kind: "markup",
  revision: 1,
  visibility: "published",
  authorId: "user",
  authorName: "Tim",
  createdAt: "",
  updatedAt: "",
  comments: [],
  data: {
    sourceSheetId: sheetKey,
    type: "rect",
    points: [
      { x: 0.25, y: 0.25 },
      { x: 0.5, y: 0.5 },
    ],
    stroke: "#ef4444",
    width: 2,
  },
};

beforeEach(() => {
  loadPipeLinework.mockReset().mockResolvedValue(linework);
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
  });
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
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function open(props: Partial<ComponentProps<typeof DrawingSheetViewer>> = {}) {
  const base = {
    src: "/sheet.webp",
    alt: "Pipe drawing",
    sheetKey,
    pdf,
    sharedScale: { unit: "m" as const, unitsPerSheetWidth: 100 },
    ...props,
  };
  const view = render(<DrawingSheetViewer {...base} />);
  const image = screen.getByAltText("Pipe drawing");
  const frame = image.parentElement!.parentElement!;
  Object.defineProperties(image, {
    naturalWidth: { value: 1000 },
    naturalHeight: { value: 500 },
  });
  Object.defineProperties(frame, {
    clientWidth: { value: 800, configurable: true },
    clientHeight: { value: 600, configurable: true },
  });
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  });
  fireEvent.load(image);
  return { ...view, frame, image, base };
}
async function activate() {
  fireEvent.click(screen.getByRole("button", { name: "Pipe system" }));
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Pipe system" }),
    ).toBeInTheDocument(),
  );
}
function tap(frame: Element, x: number, y: number, pointerId = 1) {
  fireEvent.pointerDown(frame, {
    clientX: x,
    clientY: y,
    pointerId,
    button: 0,
  });
  fireEvent.pointerUp(frame, { clientX: x, clientY: y, pointerId, button: 0 });
}
function total() {
  return screen.getByRole("status", { name: "Pipe total distance" });
}

describe("pipe selection in the drawing viewer", () => {
  it("allows a failed PDF read to retry and then select a calibrated run", async () => {
    loadPipeLinework.mockRejectedValueOnce(new Error("offline"));
    const { frame } = open();
    fireEvent.click(screen.getByRole("button", { name: "Pipe system" }));
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByRole("alert")).toHaveTextContent("could not be read");
    fireEvent.click(retry);
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Pipe system" }),
      ).toBeInTheDocument(),
    );
    tap(frame, 160, 300);
    expect(total()).toHaveTextContent("110 m");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(loadPipeLinework).toHaveBeenCalledTimes(2);
  });
  it.each([
    [160, 300, "line"],
    [380, 300, "label"],
  ] as const)(
    "selects ST branches from the %s,%s %s tap and displays the calibrated union total",
    async (x, y, _kind) => {
      const { frame } = open();
      await activate();
      tap(frame, x, y);
      expect(screen.getByText("ST system")).toBeInTheDocument();
      expect(total()).toHaveTextContent("110 m");
      expect(total()).toHaveTextContent("Total distance · this sheet");
      const highlight = screen.getByRole("img", {
        name: "Selected pipe system",
      });
      expect(highlight).toHaveAttribute("data-pipe-segment-count", "5");
      expect(highlight.querySelector("path")!.getAttribute("d")).toContain(
        "M300,250L300,100",
      );
      expect(highlight.querySelector("path")!.getAttribute("d")).not.toContain(
        "M600,50L600,450",
      );
      expect(highlight.querySelector("path")!.getAttribute("d")).not.toContain(
        "M100,450L300,450",
      );
      fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
      expect(
        screen.queryByRole("img", { name: "Selected pipe system" }),
      ).toBeNull();
      expect(
        screen.queryByRole("status", { name: "Pipe total distance" }),
      ).toBeNull();
    },
  );

  it("highlights a run without inventing a distance when the sheet scale is unset", async () => {
    const { frame } = open({ sharedScale: null });
    await activate();
    tap(frame, 160, 300);
    expect(
      screen.getByRole("img", { name: "Selected pipe system" }),
    ).toBeInTheDocument();
    expect(total()).toHaveTextContent("Set scale to see distance");
    expect(total()).not.toHaveTextContent(/\d+\s*(?:m|ft|mm)/);
    expect(screen.getByRole("button", { name: "Set scale" })).toBeDisabled();
  });

  it("converts the same calibrated total among meters, millimeters, feet, and inches", async () => {
    const { frame } = open();
    await activate();
    tap(frame, 160, 300);
    const units = screen.getByRole("group", { name: "Pipe distance units" });
    for (const unit of ["mm", "ft", "in", "m"] as const) {
      fireEvent.click(within(units).getByRole("button", { name: unit }));
      expect(total()).toHaveTextContent(formatLengthAs(110, "m", unit));
      expect(
        screen.getByRole("img", { name: "Selected pipe system" }),
      ).toHaveAttribute("data-pipe-segment-count", "5");
    }
  });

  it.each(["pan", "pinch", "cancel"])(
    "does not select a pipe after a %s gesture",
    async (gesture) => {
      const { frame } = open();
      await activate();
      fireEvent.pointerDown(frame, {
        clientX: 160,
        clientY: 300,
        pointerId: 1,
        button: 0,
      });
      if (gesture === "pan") {
        fireEvent.pointerMove(frame, {
          clientX: 200,
          clientY: 330,
          pointerId: 1,
          button: 0,
        });
        fireEvent.pointerUp(frame, {
          clientX: 200,
          clientY: 330,
          pointerId: 1,
          button: 0,
        });
      } else if (gesture === "pinch") {
        fireEvent.pointerDown(frame, {
          clientX: 500,
          clientY: 300,
          pointerId: 2,
          button: 0,
        });
        fireEvent.pointerMove(frame, {
          clientX: 550,
          clientY: 300,
          pointerId: 2,
          button: 0,
        });
        fireEvent.pointerUp(frame, {
          clientX: 550,
          clientY: 300,
          pointerId: 2,
          button: 0,
        });
        fireEvent.pointerUp(frame, {
          clientX: 160,
          clientY: 300,
          pointerId: 1,
          button: 0,
        });
      } else {
        fireEvent.pointerCancel(frame, { pointerId: 1 });
        fireEvent.pointerUp(frame, {
          clientX: 160,
          clientY: 300,
          pointerId: 1,
          button: 0,
        });
      }
      expect(
        screen.queryByRole("img", { name: "Selected pipe system" }),
      ).toBeNull();
      expect(
        screen.queryByRole("status", { name: "Pipe total distance" }),
      ).toBeNull();
      expect(screen.getByText("Select a pipe system")).toBeInTheDocument();
    },
  );

  it.each(["rect", "freehand", "select"] as const)(
    "prevents annotation creation, movement, resizing, or deletion while %s is overridden by pipe mode",
    async (tool) => {
      const onCreate = vi.fn(),
        onUpdate = vi.fn(),
        onDelete = vi.fn(),
        onSelect = vi.fn();
      const { frame, container } = open({
        tool,
        annotations: [entity],
        selectedId: "markup",
        onCreate,
        onUpdate,
        onDelete,
        onSelect,
      });
      await activate();
      expect(container.querySelector("[data-annotation-handle]")).toBeNull();
      expect(container.querySelector("[data-annotation-move-area]")).toBeNull();
      tap(frame, 160, 300);
      const shape = container.querySelector(
        '[data-annotation-id="markup"] rect',
      )!;
      fireEvent.pointerDown(shape, {
        clientX: 250,
        clientY: 250,
        pointerId: 1,
        button: 0,
      });
      fireEvent.pointerMove(frame, {
        clientX: 300,
        clientY: 280,
        pointerId: 1,
        button: 0,
      });
      fireEvent.pointerUp(frame, {
        clientX: 300,
        clientY: 280,
        pointerId: 1,
        button: 0,
      });
      fireEvent.keyDown(window, { key: "Delete" });
      expect(onCreate).not.toHaveBeenCalled();
      expect(onUpdate).not.toHaveBeenCalled();
      expect(onDelete).not.toHaveBeenCalled();
      expect(onSelect).not.toHaveBeenCalled();
    },
  );

  it("clears selection and pipe mode when the source sheet, URL, or page changes", async () => {
    const { frame, rerender, base } = open();
    await activate();
    tap(frame, 160, 300);
    expect(total()).toHaveTextContent("110 m");
    rerender(
      <DrawingSheetViewer
        {...base}
        sheetKey="different-sheet"
        pdf={{ url: "/second.pdf", page: 2 }}
      />,
    );
    expect(
      screen.queryByRole("img", { name: "Selected pipe system" }),
    ).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Pipe system selection" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Pipe system" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await activate();
    expect(
      screen.queryByRole("status", { name: "Pipe total distance" }),
    ).toBeNull();
    expect(loadPipeLinework).toHaveBeenLastCalledWith({
      url: "/second.pdf",
      page: 2,
    });
  });

  it("ignores stale loading results when the PDF changes before extraction completes", async () => {
    let resolveOld: (value: PipeLinework) => void = () => undefined;
    loadPipeLinework.mockImplementationOnce(
      () =>
        new Promise<PipeLinework>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const { rerender, base } = open();
    fireEvent.click(screen.getByRole("button", { name: "Pipe system" }));
    expect(screen.getByText("Reading pipe lines…")).toBeInTheDocument();
    rerender(
      <DrawingSheetViewer {...base} pdf={{ url: "/second.pdf", page: 2 }} />,
    );
    await act(async () => {
      resolveOld(linework);
    });
    expect(
      screen.queryByRole("region", { name: "Pipe system selection" }),
    ).toBeNull();
    await activate();
    expect(
      loadPipeLinework.mock.calls.filter(
        ([source]) => source.url === "/pipe-drawing.pdf",
      ),
    ).toHaveLength(1);
    expect(loadPipeLinework).toHaveBeenLastCalledWith({
      url: "/second.pdf",
      page: 2,
    });
    expect(
      screen.queryByRole("status", { name: "Pipe total distance" }),
    ).toBeNull();
  });

  it("reports empty vector pages and marks bounded partial totals", async () => {
    loadPipeLinework.mockResolvedValueOnce({
      ...linework,
      segments: [],
      labels: [],
    });
    const empty = open();
    fireEvent.click(screen.getByRole("button", { name: "Pipe system" }));
    await waitFor(() =>
      expect(
        screen.getByText(/This page has no selectable vector pipe lines/),
      ).toBeInTheDocument(),
    );
    empty.unmount();
    loadPipeLinework.mockResolvedValueOnce({ ...linework, truncated: true });
    const { frame } = open();
    await activate();
    tap(frame, 160, 300);
    expect(total()).toHaveTextContent("Partial distance · this sheet");
    expect(
      screen.getByText(/Highlight and length are partial/),
    ).toBeInTheDocument();
  });
});
