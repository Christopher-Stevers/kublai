import type { SuperScaleOutput } from "~/lib/super-scale-job";
type MockJob = {id:string; status:string; first?:string; progress?:string; output?:SuperScaleOutput};
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
  job: null as MockJob | null,
  start: vi.fn(),
  cancel: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
  read: vi.fn(),
  close: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("~/trpc/react", async () => {
  const { useState } = await import("react");
  return {
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
        superScaleStart: { useMutation: () => ({ mutateAsync: mocks.start }) },
        superScaleCancel: {
          useMutation: () => ({ mutateAsync: mocks.cancel }),
        },
        superScaleLatest: {
          useQuery: () => {
            const [, refresh] = useState(0);
            return {
              data: mocks.job,
              isSuccess: true,
              refetch: async () => refresh((v) => v + 1),
            };
          },
        },
      },
    },
  };
});
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
  mocks.job = {
    id: "reference",
    status: "completed",
    first: "",
    output: {
      reference: grids(),
      revision: 4,
      sourceId: "source",
      first: "",
      second: "",
      rows: [],
    },
  };
  mocks.start.mockImplementation(async (input: {first:string; second:string}) => {
    mocks.job = {
      id: "scan",
      status: "completed",
      first: input.first,
      output: {
        reference: grids(),
        revision: 4,
        sourceId: "source",
        first: input.first,
        second: input.second,
        rows: [
          {
            sheet: sheet("target"),
            ownerId: "target",
            metadata: meta("target"),
            grids: grids(0.5),
            scale: { unit: "m", unitsPerSheetWidth: 60 },
            selected: true,
            status: "Matched",
          },
          {
            sheet: sheet("existing"),
            ownerId: "existing",
            metadata: meta("existing", true),
            selected: false,
            status: "Already calibrated — kept",
          },
        ],
      },
    };
    return mocks.job;
  });
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

it("closing a running scan leaves the server job running", async () => {
  mocks.job = {
    id: "running",
    status: "running",
    progress: "Checking drawing 2",
  };
  const onClose = vi.fn();
  const view = render(
    <SuperScaleDialog
      jobId="job"
      source={sheet("source")}
      ownerId="source"
      metadata={meta("source", true)}
      sheets={[]}
      onClose={onClose}
      onSaved={() => undefined}
    />,
  );
  await screen.findByText("Checking drawing 2");
  fireEvent.click(
    screen.getAllByRole("button", { name: "Close" })[0]!,
  );
  expect(onClose).toHaveBeenCalled();
  view.unmount();
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});
it("reopening restores completed server results without parsing a PDF", async () => {
  await mocks.start({ first: "A", second: "B" });
  mocks.start.mockClear();
  open();
  await screen.findByRole("button", { name: "Apply to 1 drawing" });
  expect(mocks.start).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});
