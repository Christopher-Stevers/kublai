import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  drawingMetadataSchema,
  type DrawingJobSheet,
} from "~/lib/drawing-workspace";
import { identifyGrids } from "~/lib/super-scale";
import { SuperScaleDialog } from "./SuperScaleDialog";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
  read: vi.fn(),
  close: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      drawingsWorkspace: {
        list: { fetch: mocks.list },
        get: { fetch: mocks.get },
        invalidate: mocks.invalidate,
      },
    }),
    drawingsWorkspace: {
      metadata: { useMutation: () => ({ mutateAsync: mocks.save }) },
    },
  },
}));
vi.mock("~/lib/pdf-super-scale", () => ({
  createGridReader: () => ({ read: mocks.read, close: mocks.close }),
}));
const sheet = (id: string): DrawingJobSheet => ({
  id,
  sheetId: id,
  setId: "set",
  setName: "Mechanical",
  name: id,
  imageUrl: id,
  width: 1000,
  height: 1000,
  sourceFilename: null,
});
const meta = (id: string, calibrated = false) => ({
  ...drawingMetadataSchema.parse({
    title: "Keep this title",
    scale: calibrated ? { unit: "m", unitsPerSheetWidth: 30 } : null,
  }),
  revision: 4,
  currentSourceSheetId: id,
});
const grids = (factor = 1) =>
  identifyGrids(
    [0.2, 0.4, 0.6].map((x) => ({
      x1: x * factor,
      x2: x * factor,
      y1: 0.1,
      y2: 0.9,
    })),
    [0.2, 0.4, 0.6].map((x, i) => ({
      text: String.fromCharCode(65 + i),
      x: x * factor,
      y: 0.09,
    })),
    1,
  );
beforeEach(() => {
  vi.resetAllMocks();
  mocks.close.mockResolvedValue(undefined);
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.read.mockImplementation(async (url: string) =>
    grids(url === "source" ? 1 : 0.5),
  );
  mocks.list.mockResolvedValue(
    ["source", "target", "existing"].map((id) => ({
      sheetId: id,
      metadata: meta(id, id !== "target"),
    })),
  );
  mocks.get.mockResolvedValue({ metadata: meta("source", true) });
  mocks.save.mockResolvedValue({});
});
afterEach(cleanup);
function open() {
  render(
    <SuperScaleDialog
      jobId="job"
      source={sheet("source")}
      ownerId="source"
      metadata={meta("source", true)}
      sheets={["source", "target", "existing"].map(sheet)}
      onClose={() => undefined}
      onSaved={() => undefined}
    />,
  );
}
async function scan() {
  await waitFor(() =>
    expect(screen.getByLabelText("First grid")).not.toBeDisabled(),
  );
  fireEvent.change(screen.getByLabelText("First grid"), {
    target: { value: "A" },
  });
  fireEvent.change(screen.getByLabelText("Second grid"), {
    target: { value: "B" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Find matching drawings" }),
  );
  await screen.findByRole("button", { name: "Apply to 1 drawing" });
}
it("previews matches, preserves existing scales and saves with the scanned revision", async () => {
  open();
  await scan();
  expect(screen.getByText("Already calibrated — kept")).toBeInTheDocument();
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apply to 1 drawing" }));
  await screen.findByText("Scale saved");
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save.mock.calls[0]?.[0]).toMatchObject({
    sheetId: "target",
    expectedRevision: 4,
    data: {
      title: "Keep this title",
      scale: { unit: "m", unitsPerSheetWidth: 60 },
    },
  });
});
it("refuses to apply when the reference revision changed", async () => {
  open();
  await scan();
  mocks.get.mockResolvedValue({
    metadata: { ...meta("source", true), revision: 5 },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply to 1 drawing" }));
  await screen.findByText(/reference drawing changed/);
  expect(mocks.save).not.toHaveBeenCalled();
});
it("reports failed saves instead of claiming all drawings were calibrated", async () => {
  open();
  await scan();
  mocks.save.mockRejectedValue(new Error("Drawing changed"));
  fireEvent.click(screen.getByRole("button", { name: "Apply to 1 drawing" }));
  await screen.findByText("Not saved: Drawing changed");
  expect(
    screen.getByText("0 drawings calibrated. Existing scales were kept."),
  ).toBeInTheDocument();
});
it("does not offer transfers without a reference calibration", async () => {
  render(
    <SuperScaleDialog
      jobId="job"
      source={sheet("source")}
      ownerId="source"
      metadata={meta("source")}
      sheets={[]}
      onClose={() => undefined}
      onSaved={() => undefined}
    />,
  );
  expect(screen.getByText(/First calibrate this drawing/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Find matching drawings" }),
  ).toBeNull();
});
