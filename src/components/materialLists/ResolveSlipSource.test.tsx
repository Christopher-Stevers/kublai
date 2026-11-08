import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ResolveSlipSource } from "./ResolveSlipSource";
const mocks = vi.hoisted(() => ({
  pdf: vi.fn(),
  draw: vi.fn(),
  destroy: vi.fn(),
  text: vi.fn(),
}));
vi.mock("~/lib/pdf-client", () => ({
  loadPdfJs: async () => ({
    getDocument: mocks.pdf,
    Util: {
      transform: (_viewport: number[], transform: number[]) => transform,
    },
  }),
}));
const url =
  "/api/job-documents/files/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb?jobId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const use = vi.fn();
const cancel = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: mocks.draw,
  } as unknown as CanvasRenderingContext2D);
  mocks.text.mockResolvedValue({
    items: [
      {
        str: "3 inch coupling 25",
        transform: [20, 0, 0, -20, 100, 320],
        width: 400,
        height: 20,
      },
    ],
  });
  mocks.destroy.mockResolvedValue(undefined);
  mocks.pdf.mockReturnValue({
    destroy: mocks.destroy,
    promise: Promise.resolve({
      numPages: 2,
      getPage: async () => ({
        getViewport: () => ({
          width: 1000,
          height: 1000,
          transform: [1, 0, 0, 1, 0, 0],
        }),
        render: () => ({ promise: Promise.resolve() }),
        getTextContent: mocks.text,
      }),
    }),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) =>
      input.includes("/source-text")
        ? {
            ok: true,
            json: async () => ({
              words: [
                {
                  page: 1,
                  text: "Saved OCR line",
                  x: 0.1,
                  y: 0.3,
                  width: 0.4,
                  height: 0.02,
                },
              ],
            }),
          }
        : {
            ok: true,
            blob: async () => ({
              type: "application/pdf",
              slice: () => ({ text: async () => "%PDF-" }),
              arrayBuffer: async () => new ArrayBuffer(5),
            }),
          },
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const open = async () => {
  render(
    <ResolveSlipSource
      url={url}
      initialBox={{ x: 0.05, y: 0.29, width: 0.7, height: 0.04 }}
      onUse={use}
      onCancel={cancel}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Read selected area" }),
    ).not.toBeDisabled(),
  );
};
it("reads actual selected PDF text, allows correction, and only emits on explicit use", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Read selected area" }));
  expect(screen.getByRole("textbox")).toHaveValue("3 inch coupling 25");
  expect(use).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "3 inch coupling — 30 handwritten" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Use this line" }));
  expect(use).toHaveBeenCalledWith({
    page: 1,
    box: { x: 0.05, y: 0.29, width: 0.7, height: 0.03999999999999998 },
    description: "3 inch coupling — 30 handwritten",
  });
});
it("uses previously saved OCR for a scanned page with no embedded text", async () => {
  mocks.text.mockResolvedValue({ items: [] });
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Read selected area" }));
  expect(screen.getByRole("textbox")).toHaveValue("Saved OCR line");
  expect(screen.getByRole("status")).toHaveTextContent("Saved OCR text");
});
it("dragging selects the actual area and clears the earlier line before reading it", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Read selected area" }));
  fireEvent.click(screen.getByRole("button", { name: "Select area" }));
  const region = screen.getByRole("img").parentElement!;
  vi.spyOn(region, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 1000,
    height: 1000,
    right: 1000,
    bottom: 1000,
    toJSON: () => ({}),
  });
  region.setPointerCapture = vi.fn();
  region.hasPointerCapture = vi.fn(() => true);
  region.releasePointerCapture = vi.fn();
  fireEvent.pointerDown(region, {
    pointerId: 1,
    button: 0,
    clientX: 50,
    clientY: 600,
  });
  fireEvent.pointerMove(region, { pointerId: 1, clientX: 800, clientY: 650 });
  fireEvent.pointerUp(region, { pointerId: 1, clientX: 800, clientY: 650 });
  expect(screen.getByRole("textbox")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Read selected area" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "No readable saved text in this area",
  );
  expect(use).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Missed line seen in image" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Use this line" }));
  expect(use).toHaveBeenCalledWith({
    page: 1,
    box: { x: 0.05, y: 0.6, width: 0.75, height: 0.050000000000000044 },
    description: "Missed line seen in image",
  });
});
it("clears old crop and recovered text on a page change and allows manual entry without inventing OCR", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Read selected area" }));
  fireEvent.click(screen.getByRole("button", { name: "Next slip page" }));
  expect(screen.getByRole("textbox")).toHaveValue("");
  expect(
    screen.getByRole("button", { name: "Read selected area" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Printed item from page 2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Use this line" }));
  expect(use).toHaveBeenCalledWith({
    page: 2,
    box: undefined,
    description: "Printed item from page 2",
  });
});
it("keeps manual fallback available when the original cannot load", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false })),
  );
  render(<ResolveSlipSource url={url} onUse={use} onCancel={cancel} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be loaded",
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Manually checked line" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Use this line" }));
  expect(use).toHaveBeenCalledWith({
    page: 1,
    box: undefined,
    description: "Manually checked line",
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(cancel).toHaveBeenCalledTimes(1);
});
it("detects across the complete row without requiring saved OCR text", async () => {
  const detect = vi.fn().mockResolvedValue(undefined);
  render(<ResolveSlipSource url={url} initialBox={{x:.4,y:.3,width:.2,height:.03}} onUse={use} onCancel={cancel} onDetect={detect} />);
  await waitFor(() => expect(screen.getByRole("button", {name:"Detect This Line"})).toBeEnabled());
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name:"Detect This Line"}));
  expect(detect).toHaveBeenCalledWith(1, {x:0,y:.3,width:1,height:expect.closeTo(.03)});
  expect(use).not.toHaveBeenCalled();
});
