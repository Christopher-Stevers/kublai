import { afterEach, expect, it, vi } from "vitest";
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
vi.mock("~/lib/scanning/page", () => ({
  detectPage: () => ({ quad, brightness: 60, sharpness: 100 }),
  stablePage: () => true,
  scanPage: async () => "data:image/jpeg;base64,test",
  scanPdf: async () =>
    new File(["pdf"], "Packing slip.pdf", { type: "application/pdf" }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("automatically captures, stops the camera, keeps pages after failed save, and saves a multipage PDF on Done", async () => {
  const stop = vi.fn(),
    applyConstraints = vi.fn(async () => {}),
    track = {
      stop,
      getCapabilities: () => ({ torch: true }),
      applyConstraints,
    };
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
    drawImage: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray() }),
  } as unknown as CanvasRenderingContext2D);
  const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<PackingSlipScanner onSave={save} onCancel={() => {}} />);
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
it("offers recovery when permission is denied", async () => {
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(async () => {
        throw Error("Camera permission denied");
      }),
    },
  });
  render(<PackingSlipScanner onSave={vi.fn()} onCancel={() => {}} />);
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
    <PackingSlipScanner onSave={vi.fn()} onCancel={() => {}} />,
  );
  view.unmount();
  resolve({ getTracks: () => [{ stop }] });
  await waitFor(() => expect(stop).toHaveBeenCalled());
});
