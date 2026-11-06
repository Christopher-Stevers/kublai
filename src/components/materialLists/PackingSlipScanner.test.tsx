import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import PackingSlipScanner from "./PackingSlipScanner";
const quad = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
];
const scanning = vi.hoisted(() => ({
  detectPage: vi.fn(),
  grabFrame: vi.fn(() => ({
    data: new Uint8ClampedArray(4),
    width: 1,
    height: 1,
  })),
  pageBlur: vi.fn(() => 0.7),
  rectifyPage: vi.fn(async () => ({
    data: new Uint8ClampedArray(4),
    width: 1,
    height: 1,
  })),
}));
vi.mock("~/lib/scanning/page", () => ({
  detectPage: scanning.detectPage,
  cornerShift: () => 0,
  averageQuad: (quads: unknown[]) => quads[0],
  grabFrame: scanning.grabFrame,
  locatePage: (_: unknown, q: unknown) => q,
  BLURRY: 1.25,
  pageBlur: scanning.pageBlur,
  rectifyPage: scanning.rectifyPage,
  toJpeg: () => "data:image/jpeg;base64,test",
  scanPdf: async (_pages: string[], filename = "Packing slip.pdf") =>
    new File(["pdf"], filename, { type: "application/pdf" }),
}));
beforeEach(() => {
  scanning.grabFrame.mockClear();
  scanning.pageBlur.mockReset().mockReturnValue(0.7);
  scanning.detectPage.mockReturnValue({
    quad,
    brightness: 60,
    sharpness: 100,
    clipped: false,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function camera(capabilities: object = { torch: true }) {
  const stop = vi.fn(),
    applyConstraints = vi.fn(async () => undefined),
    track = { stop, getCapabilities: () => capabilities, applyConstraints };
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [track],
        getVideoTracks: () => [track],
      })),
    },
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(
    1000,
  );
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(
    1500,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray() }),
  } as unknown as CanvasRenderingContext2D);
  return { stop, applyConstraints };
}
it("automatically captures, stops the camera, keeps pages after failed save, and saves a multipage PDF on Done", async () => {
  const { stop, applyConstraints } = camera();
  const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<PackingSlipScanner onSave={save} onCancel={vi.fn()} />);
  await screen.findByText(/Page 1 captured/, {}, { timeout: 3000 });
  expect(stop).toHaveBeenCalled();
  expect(applyConstraints).toHaveBeenCalledWith({
    advanced: [{ torch: true }],
  });
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Next page"));
  await screen.findByText(/Page 2 captured/, {}, { timeout: 3000 });
  fireEvent.click(screen.getByText("Done"));
  await screen.findByText(/Your captured pages are retained/);
  fireEvent.click(screen.getByText("Done"));
  await screen.findByText(/PDF saved in Documents/);
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1]![0]).toBe(save.mock.calls[0]![0]);
});
it("tries again for a sharper frame and warns when every one is blurry", async () => {
  camera();
  scanning.pageBlur.mockReturnValue(2);
  render(<PackingSlipScanner onSave={vi.fn()} onCancel={vi.fn()} />);
  await screen.findByText(/Page 1 captured/, {}, { timeout: 3000 });
  expect(scanning.grabFrame).toHaveBeenCalledTimes(3);
  expect(screen.getByText(/This page looks blurry/)).toBeInTheDocument();
  // A sharp second frame is kept, with no warning.
  cleanup();
  scanning.grabFrame.mockClear();
  scanning.pageBlur.mockReset().mockReturnValueOnce(2).mockReturnValue(0.7);
  camera();
  render(<PackingSlipScanner onSave={vi.fn()} onCancel={vi.fn()} />);
  await screen.findByText(/Page 1 captured/, {}, { timeout: 3000 });
  expect(scanning.grabFrame).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(/This page looks blurry/)).toBeNull();
});

it("asks to move back when the page is cut off", async () => {
  camera();
  scanning.detectPage.mockReturnValue({
    quad: null,
    brightness: 150,
    sharpness: 0,
    clipped: true,
  });
  render(<PackingSlipScanner onSave={vi.fn()} onCancel={vi.fn()} />);
  await screen.findByText(/Move back so all four corners/);
});
it("captures by hand without a detected page, then straightens it from the corners placed", async () => {
  camera({});
  scanning.detectPage.mockReturnValue({
    quad: null,
    brightness: 150,
    sharpness: 0,
    clipped: false,
  });
  render(<PackingSlipScanner onSave={vi.fn()} onCancel={vi.fn()} />);
  const capture = await screen.findByText("Capture now");
  await waitFor(() => expect(capture).toBeEnabled());
  fireEvent.click(capture);
  const corner = await screen.findByLabelText("Corner 1");
  vi.spyOn(corner.parentElement!, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 200,
    height: 400,
  } as DOMRect);
  fireEvent.pointerDown(corner, { clientX: 20, clientY: 60, pointerId: 1 });
  fireEvent.click(screen.getByText("Use these corners"));
  await screen.findByText(/Page 1 captured/);
  expect(scanning.rectifyPage).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.arrayContaining([{ x: 0.1, y: 0.15 }]),
  );
  fireEvent.click(screen.getByText("Adjust corners"));
  expect(await screen.findByLabelText("Corner 4")).toBeInTheDocument();
});
it("offers recovery when permission is denied", async () => {
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(async () => {
        throw Error("Camera permission denied");
      }),
    },
  });
  render(<PackingSlipScanner onSave={vi.fn()} onCancel={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Camera permission denied",
  );
  expect(screen.getByText("Restart camera")).toBeInTheDocument();
});
it("stops a late camera stream after unmount", async () => {
  let resolve!: (s: unknown) => void;
  const stop = vi.fn();
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: () =>
        new Promise((r) => {
          resolve = r;
        }),
    },
  });
  const view = render(
    <PackingSlipScanner onSave={vi.fn()} onCancel={vi.fn()} />,
  );
  view.unmount();
  resolve({ getTracks: () => [{ stop }] });
  await waitFor(() => expect(stop).toHaveBeenCalled());
});
it("offers an upload when the device has no camera", async () => {
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(async () => {
        throw new DOMException("Requested device not found", "NotFoundError");
      }),
    },
  });
  const onUpload = vi.fn();
  render(
    <PackingSlipScanner
      onSave={vi.fn()}
      onCancel={vi.fn()}
      onUpload={onUpload}
    />,
  );
  await screen.findByText(/No camera found on this device/);
  fireEvent.click(screen.getByRole("button", { name: "Upload photo or PDF" }));
  expect(onUpload).toHaveBeenCalledOnce();
});

it("saves ordinary documents with a document filename and destination message", async () => {
  camera();
  const save = vi.fn().mockResolvedValue(true);
  render(<PackingSlipScanner documentKind="document" onSave={save} onCancel={vi.fn()} />);
  await screen.findByText(/Page 1 captured/, {}, { timeout: 3000 });
  expect(screen.getByAltText("Captured document page")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Done"));
  await screen.findByText("✓ PDF saved in Documents.");
  expect((save.mock.calls[0]![0] as File).name).toBe("Scanned document.pdf");
  expect(screen.queryByText(/linked to this order/)).not.toBeInTheDocument();
});

it("puts its buttons in the page's bottom bar when given one", async () => {
  camera();
  scanning.pageBlur.mockReturnValue(0.7);
  const bar = document.createElement("div");
  document.body.append(bar);
  render(
    <PackingSlipScanner
      actionBar={bar}
      extraActions={<button key="saved">Saved slips</button>}
      pageAction={() => <button key="queue">Queue</button>}
      onSave={vi.fn()}
      onCancel={vi.fn()}
      onUpload={vi.fn()}
    />,
  );
  const labels = () =>
    Array.from(
      bar.querySelectorAll("[data-action-bar-row] button"),
      (button) => button.textContent,
    );
  expect(labels()).toEqual(["Upload", "Queue", "Capture"]);
  expect(screen.queryByRole("button", { name: "Cancel scan" })).toBeNull();
  await screen.findByText(/Page 1 captured/, {}, { timeout: 3000 });
  expect(labels()).toEqual(["Retake last page", "Next page", "Done"]);
  bar.remove();
});
