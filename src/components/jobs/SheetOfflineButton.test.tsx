import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SheetOfflineButton } from "./SheetOfflineButton";
const mocks = vi.hoisted(() => ({
  store: { readSnapshot: vi.fn(), readAsset: vi.fn(), saveSnapshot: vi.fn(), saveAssets: vi.fn(), summary: vi.fn() },
  warm: vi.fn(), collect: vi.fn(),
}));
vi.mock("./DrawingAccountProvider", () => ({ useDrawingAccount: () => ({ store: mocks.store }) }));
vi.mock("~/lib/drawing-pdf-offline-runtime", () => ({ warmDrawingPdfRuntime: mocks.warm }));
vi.mock("~/lib/drawing-offline", () => ({ collectDrawingOfflineUrls: mocks.collect }));
const sheet = { id: "s1", name: "A101", imageUrl: "/sheet.webp" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.store.readSnapshot.mockResolvedValue(null);
  mocks.store.readAsset.mockResolvedValue(new Blob(["drawing"]));
  mocks.store.summary.mockResolvedValue({ bytes: 0 });
  mocks.store.saveAssets.mockResolvedValue(undefined);
  mocks.collect.mockResolvedValue(["/sheet.webp", "/plan.pdf"]);
  mocks.warm.mockResolvedValue(undefined);
});
afterEach(cleanup);
it("saves the selected sheet with its current revision and metadata before marking it available", async () => {
  const prepare = vi.fn(async () => ["/current.webp"]);
  render(<SheetOfflineButton sheet={sheet} prepare={prepare} />);
  fireEvent.click(screen.getByRole("button", { name: "Save A101 offline" }));
  await screen.findByRole("button", { name: "A101 available offline; refresh" });
  expect(prepare).toHaveBeenCalled();
  expect(mocks.collect).toHaveBeenCalledWith(["/sheet.webp", "/current.webp"], expect.anything());
  expect(mocks.store.saveAssets).toHaveBeenCalledWith(["/sheet.webp", "/plan.pdf"], expect.objectContaining({ budgetBytes: expect.any(Number), signal: expect.any(AbortSignal) }));
  expect(mocks.store.saveSnapshot).toHaveBeenCalledWith("sheet-download:s1:/sheet.webp", ["/sheet.webp", "/plan.pdf"]);
});
it("restores a saved badge only when every required asset remains on the device", async () => {
  mocks.store.readSnapshot.mockResolvedValue(["/sheet.webp", "/plan.pdf"]);
  mocks.store.readAsset.mockImplementation(async (url: string) => url.endsWith("pdf") ? null : new Blob(["image"]));
  const first = render(<SheetOfflineButton sheet={sheet} />);
  await waitFor(() => expect(mocks.store.readAsset).toHaveBeenCalledWith("/plan.pdf"));
  expect(screen.queryByText("Available offline")).toBeNull();
  first.unmount();
  mocks.store.readAsset.mockResolvedValue(new Blob(["retained"]));
  render(<SheetOfflineButton sheet={sheet} />);
  await screen.findByText("Available offline");
});
it("does not claim success when storage fails or saving is cancelled", async () => {
  mocks.store.saveAssets.mockRejectedValue(Error("Device storage is full"));
  render(<SheetOfflineButton sheet={sheet} />);
  fireEvent.click(screen.getByRole("button", { name: "Save A101 offline" }));
  await screen.findByRole("alert");
  expect(mocks.store.saveSnapshot).not.toHaveBeenCalled();
  mocks.store.saveAssets.mockImplementation(async (_urls, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(Error("cancelled")))));
  fireEvent.click(screen.getByRole("button", { name: "Save A101 offline" }));
  await waitFor(() => expect(mocks.store.saveAssets).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "Cancel saving A101 offline" }));
  await screen.findByRole("button", { name: "Save A101 offline" });
  expect(mocks.store.saveSnapshot).not.toHaveBeenCalled();
});

const original = "/api/job-rooms/files/0391aed4-7773-47ec-9141-09df373ec008/d814fc88-da7c-4df5-aa89-fe3c1fde0462/floor-1.webp";
const current = original.replace("floor-1", "floor-2");
const workspace = { sheetId: "s1", metadata: { currentSourceSheetId: "revision" }, jobSheets: [
  { id: "s1", imageUrl: original }, { id: "revision", imageUrl: current },
] };
it("recognizes an existing folder download without an individual marker or another download", async () => {
  mocks.store.readSnapshot.mockImplementation(async key => key === "workspace:s1" ? workspace : null);
  render(<SheetOfflineButton sheet={{ ...sheet, imageUrl: original }} />);
  await screen.findByText("Available offline");
  expect(mocks.store.readAsset).toHaveBeenCalledWith(original);
  expect(mocks.store.readAsset).toHaveBeenCalledWith(current);
  expect(mocks.store.readAsset).toHaveBeenCalledWith(original.replace("floor-1.webp", "plan.pdf"));
  expect(mocks.store.saveAssets).not.toHaveBeenCalled();
  expect(mocks.warm).not.toHaveBeenCalled();
});
it("does not call a folder sheet available if its current revision or workspace is missing", async () => {
  mocks.store.readSnapshot.mockImplementation(async key => key === "workspace:s1" ? workspace : null);
  mocks.store.readAsset.mockImplementation(async url => url === current ? null : new Blob(["drawing"]));
  render(<SheetOfflineButton sheet={{ ...sheet, imageUrl: original }} />);
  await waitFor(() => expect(mocks.store.readAsset).toHaveBeenCalledWith(current));
  expect(screen.queryByText("Available offline")).toBeNull();
});
it("updates mounted sheets when a folder finishes saving or downloads are removed", async () => {
  render(<SheetOfflineButton sheet={{ ...sheet, imageUrl: original }} workspaceSheetId="owner" />);
  await waitFor(() => expect(mocks.store.readSnapshot).toHaveBeenCalledWith("workspace:owner"));
  expect(screen.queryByText("Available offline")).toBeNull();
  mocks.store.readSnapshot.mockImplementation(async key => key === "workspace:owner" ? workspace : null);
  window.dispatchEvent(new Event("foremanhq-drawing-downloads-changed"));
  await screen.findByText("Available offline");
  mocks.store.readSnapshot.mockResolvedValue(null);
  window.dispatchEvent(new Event("foremanhq-drawing-downloads-changed"));
  await waitFor(() => expect(screen.queryByText("Available offline")).toBeNull());
});
