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
  const frame = image.closest<HTMLElement>('[data-drawing-sheet-layer]')!.parentElement!;
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

it("choosing a saved system immediately highlights disconnected runs and excludes other systems", async () => {
  loadPipeLinework.mockResolvedValueOnce({
    aspect: 0.5, truncated: false,
    labels: [{ text: "GAS", system: "GAS", left: 0.4, right: 0.5, top: 0.49, bottom: 0.51 }],
    segments: [
      { ...line("cold-one", 0.1, 0.2, 0.3, 0.2), layer: "M-PLMB-DCWT" },
      { ...line("cold-two", 0.7, 0.8, 0.9, 0.8), layer: "M-PLMB-DCWT" },
      { ...line("hot", 0.1, 0.4, 0.8, 0.4), layer: "M-PLMB-DHWT" },
      line("unassigned", 0.3, 0.5, 0.6, 0.5),
    ],
  });
  open();
  await activate();
  const systems = screen.getByRole("combobox", { name: "Pipe system" });
  expect(within(systems).getByRole("option", { name: "Domestic cold water (DCW)" })).toBeInTheDocument();
  expect(within(systems).queryByRole("option", { name: "Gas (GAS)" })).toBeNull();
  fireEvent.change(systems, { target: { value: "DCW" } });
  await waitFor(() => expect(screen.getByRole("img", { name: "Selected pipe system" })).toHaveAttribute("data-pipe-segment-count", "2"));
  expect(screen.getByText("Highlighted line length · this sheet")).toBeInTheDocument();
  fireEvent.change(systems, { target: { value: "DHW" } });
  await waitFor(() => expect(screen.getByRole("img", { name: "Selected pipe system" })).toHaveAttribute("data-pipe-segment-count", "1"));
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(systems).toHaveValue("");
  expect(screen.queryByRole("img", { name: "Selected pipe system" })).toBeNull();
});
async function tap(frame: Element, x: number, y: number, pointerId = 1) {
  fireEvent.pointerDown(frame, {
    clientX: x,
    clientY: y,
    pointerId,
    button: 0,
  });
  fireEvent.pointerUp(frame, { clientX: x, clientY: y, pointerId, button: 0 });
  await act(async () => { await Promise.resolve(); });
}
function total() {
  return screen.getByRole("status", { name: "Pipe total distance" });
}

it("clicking a source-tagged pipe immediately selects its system before nearby text", async () => {
  loadPipeLinework.mockResolvedValueOnce({
    aspect: 0.5, truncated: false,
    labels: [{ text: "ST", system: "ST", left: 0.28, right: 0.32, top: 0.48, bottom: 0.51 }],
    segments: [
      { ...line("sanitary", 0.1, 0.5, 0.6, 0.5), layer: "M-PLMB-SANI" },
      { ...line("detached-sanitary", 0.8, 0.8, 0.9, 0.8), layer: "M-PLMB-SANI-BELW" },
      { ...line("storm", 0.1, 0.48, 0.6, 0.48), layer: "M-PLMB-STRM" },
      line("unassigned-touching", 0.6, 0.5, 0.7, 0.5),
    ],
  });
  const { frame } = open();
  await activate();
  await tap(frame, 240, 300);
  await waitFor(() => expect(screen.getByRole("img", { name: "Selected pipe system" })).toHaveAttribute("data-pipe-segment-count", "2"));
  expect(screen.getByText("Sanitary")).toBeInTheDocument();
  expect(screen.getByText("Highlighted line length · this sheet")).toBeInTheDocument();
  expect(total()).toHaveTextContent(formatLengthAs(60, "m", "m"));
});

describe("pipe selection in the drawing viewer", () => {
  it("middle-pan preserves the selected pipe run instead of selecting another run", async () => {
    const { frame, image } = open();
    await activate();
    await tap(frame, 160, 300);
    const before = total().textContent;
    const mouse = { pointerId: 1, pointerType: "mouse", button: 1, buttons: 4 };
    fireEvent.pointerDown(frame, { ...mouse, clientX: 160, clientY: 460 });
    fireEvent.pointerMove(frame, { ...mouse, clientX: 240, clientY: 500 });
    fireEvent.pointerUp(frame, { ...mouse, buttons: 0, clientX: 240, clientY: 500 });
    expect(image.closest<HTMLElement>('[data-drawing-sheet-layer]')!.style.transform).toContain("translate3d(80px, 40px, 0)");
    expect(total().textContent).toBe(before);
    await tap(frame, 240, 500);
    expect(total()).toHaveTextContent("20 m");
  });
  it("keeps the highlight four screen pixels wide while zooming the drawing", async () => {
    const { frame } = open();
    await activate();
    await tap(frame, 160, 300);
    const highlight = screen.getByRole("img", { name: "Selected pipe system" });
    expect(highlight.parentElement).toBe(frame);
    expect(highlight.closest("[data-drawing-sheet-layer]")).toBeNull();
    expect(highlight.getAttribute("style")).toBeNull();
    const stroke = () => Number(highlight.querySelectorAll("path")[1]!.getAttribute("stroke-width"));
    expect(stroke() * 800 / 1000).toBeCloseTo(4);
    fireEvent.wheel(frame, { deltaY: -500, clientX: 400, clientY: 300 });
    await waitFor(() => expect(stroke()).toBeLessThan(5));
    const scale = Number(/scale\(([^)]+)\)/.exec(frame.firstElementChild!.getAttribute("style")!)![1]);
    expect(scale).toBeGreaterThan(1);
    expect(stroke() * 800 / 1000 * scale).toBeCloseTo(4);
  });

  it("changes pipe color and width and preserves that style through zoom", async () => {
    const { frame } = open();
    await activate();
    fireEvent.click(within(screen.getByRole("group", { name: "Pipe colors" })).getByRole("button", { name: "Red" }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Pipe line width" })).getByRole("radio", { name: "Width 6" }));
    await tap(frame, 160, 300);
    const highlight = screen.getByRole("img", { name: "Selected pipe system" });
    const foreground = highlight.querySelectorAll("path")[1]!;
    const stroke = () => Number(foreground.getAttribute("stroke-width"));
    expect(foreground).toHaveAttribute("stroke", "#dc2626");
    expect(stroke() * 800 / 1000).toBeCloseTo(12);
    fireEvent.wheel(frame, { deltaY: -500, clientX: 400, clientY: 300 });
    await waitFor(() => expect(stroke()).toBeLessThan(15));
    const scale = Number(/scale\(([^)]+)\)/.exec(frame.firstElementChild!.getAttribute("style")!)![1]);
    expect(stroke() * 800 / 1000 * scale).toBeCloseTo(12);
    fireEvent.change(screen.getByLabelText("Custom pipe color"), { target: { value: "#123456" } });
    expect(foreground).toHaveAttribute("stroke", "#123456");
  });

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
    await tap(frame, 160, 300);
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
      await tap(frame, x, y);
      expect(screen.getByText("Storm")).toBeInTheDocument();
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
    await tap(frame, 160, 300);
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
    await tap(frame, 160, 300);
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
      await tap(frame, 160, 300);
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
    await tap(frame, 160, 300);
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
    expect(loadPipeLinework).toHaveBeenLastCalledWith(expect.objectContaining({
      url: "/second.pdf",
      page: 2,
      signal: expect.any(AbortSignal) as AbortSignal,
    }));
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
    expect(loadPipeLinework).toHaveBeenLastCalledWith(expect.objectContaining({
      url: "/second.pdf",
      page: 2,
      signal: expect.any(AbortSignal) as AbortSignal,
    }));
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
    await tap(frame, 160, 300);
    expect(total()).toHaveTextContent("Partial distance · this sheet");
    expect(
      screen.getByText(/Highlight and length are partial/),
    ).toBeInTheDocument();
  });
});

it('reviews detected components, locates them, saves structured counts only after confirmation and teaches a symbol', async () => {
  const save = vi.fn().mockResolvedValue(true);
  loadPipeLinework.mockResolvedValueOnce({ ...linework, componentDataVersion:1, symbols:[], texts:[{text:'2" BALL VALVE',left:.19,right:.21,top:.496,bottom:.504}] });
  const {frame}=open({onSavePipeComponent:save});
  await activate(); await tap(frame,160,300);
  fireEvent.click(screen.getByRole('button',{name:/Fittings & valves/}));
  const dialog=await screen.findByRole('dialog');
  await waitFor(()=>expect(within(dialog).getByText('Ball valve')).toBeInTheDocument());
  expect(save).not.toHaveBeenCalled();
  const row=within(dialog).getByText('Ball valve').closest('li')!;
  fireEvent.click(within(row).getByRole('button',{name:'Confirm count'}));
  await waitFor(()=>expect(save).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledWith(expect.objectContaining({type:'count',points:[{x:.2,y:.5}],pipeComponent:expect.objectContaining({kind:'valve',name:'Ball valve',size:'2"',source:'tag',system:'ST'})}));
  await waitFor(()=>expect(within(row).getByRole('button',{name:'Confirm count'})).toBeEnabled());
  fireEvent.click(within(row).getByRole('button',{name:'Locate Ball valve'}));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('img',{name:'Selected pipe system'}).querySelector('circle')).not.toBeNull();
  fireEvent.click(screen.getByRole('button',{name:/Fittings & valves/}));
  fireEvent.click(screen.getByText(/Symbol references/));
  fireEvent.click(screen.getByRole('button',{name:'Pick symbol'}));
  expect(screen.queryByRole('dialog')).toBeNull();
  await tap(frame,300,260);await tap(frame,310,270);
  await waitFor(()=>expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1]?.[0]).toMatchObject({type:'rect',layer:'Piping symbol references',pipeSymbolTemplate:{kind:'valve',name:'Valve'}});
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});
