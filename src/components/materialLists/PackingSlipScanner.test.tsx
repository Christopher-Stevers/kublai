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
  grabFrame: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  locatePage: (_: unknown, q: unknown) => q,
  rectifyPage: scanning.rectifyPage,
  toJpeg: () => "data:image/jpeg;base64,test",
  scanPdf: async () =>
    new File(["pdf"], "Packing slip.pdf", { type: "application/pdf" }),
}));
beforeEach(() => {
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
