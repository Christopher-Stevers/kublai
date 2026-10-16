import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  upload: vi.fn(),
  apply: vi.fn(),
  refresh: vi.fn(),
  open: vi.fn(),
}));
const review = {
  jobId: "job",
  uploadedSetId: "upload",
  rows: [
    {
      sourceId: "a",
      sourceName: "M-101",
      sourceRevision: 1,
      status: "matched",
      targetId: "old",
      alreadyAttached: false,
      reason: "Unique match",
      calibration: { preserve: true, reason: "Scale retained" },
    },
    {
      sourceId: "b",
      sourceName: "M-102",
      sourceRevision: 1,
      status: "new",
      targetId: null,
      alreadyAttached: false,
      reason: "New drawing",
      calibration: { preserve: false, reason: "Set scale" },
    },
    {
      sourceId: "c",
      sourceName: "Sheet 3",
      sourceRevision: 1,
      status: "uncertain",
      targetId: null,
      alreadyAttached: false,
      reason: "Number not identified",
      calibration: { preserve: false, reason: "Check calibration" },
    },
  ],
  targets: [
    { id: "old", name: "M-101", setName: "Mechanical", revision: 7 },
    { id: "another", name: "M-103", setName: "Mechanical", revision: 9 },
  ],
};
vi.mock("~/trpc/react", () => ({
  api: {
    drawings: {
      createSet: { useMutation: () => ({ mutateAsync: mocks.create }) },
    },
    drawingsWorkspace: {
      applyRevisionUpload: {
        useMutation: () => ({ mutateAsync: mocks.apply, isPending: false }),
      },
      reviewRevisionUpload: {
        useQuery: (_: unknown, options: { enabled: boolean }) => ({
          data: options.enabled ? review : undefined,
          error: null,
          isFetching: false,
        }),
      },
    },
  },
}));
vi.mock("~/lib/upload-drawings", () => ({ uploadDrawings: mocks.upload }));
vi.mock("~/components/ui/app-dialogs", () => ({ notify: vi.fn() }));
import { BulkDrawingRevisions } from "./BulkDrawingRevisions";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ id: "upload" });
  mocks.upload.mockResolvedValue([]);
  mocks.apply.mockResolvedValue({
    revised: ["M-101"],
    newSheets: ["M-102"],
    needsCalibration: ["M-101"],
    calibrationRetained: [],
    impactCount: 2,
  });
});
afterEach(cleanup);
async function open() {
  render(
    <BulkDrawingRevisions
      jobId="job"
      open
      onOpenChange={mocks.open}
      onComplete={mocks.refresh}
    />,
  );
  fireEvent.change(screen.getByLabelText("Revised PDF"), {
    target: {
      files: [new File(["PDF"], "Revision A.pdf", { type: "application/pdf" })],
    },
  });
  await screen.findByLabelText("Revision destination for M-101");
}
it("requires one confirmation, includes unique matches and new sheets, and leaves uncertain pages unassigned", async () => {
  await open();
  expect(mocks.apply).not.toHaveBeenCalled();
  expect(mocks.upload).toHaveBeenCalledWith("job", expect.any(File), {
    drawingSetId: "upload",
  });
  expect(screen.getByLabelText("Revision destination for Sheet 3")).toHaveValue(
    "skip",
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm 2 drawings" }));
  await screen.findByText("Check calibration before measuring");
  expect(mocks.apply).toHaveBeenCalledWith({
    uploadedSetId: "upload",
    label: "Revision A",
    rows: [
      {
        sourceId: "a",
        sourceRevision: 1,
        targetId: "old",
        expectedRevision: 7,
      },
      {
        sourceId: "b",
        sourceRevision: 1,
        targetId: null,
        expectedRevision: undefined,
      },
    ],
  });
  expect(
    screen.getByText(/2 possible markup\/takeoff impacts/),
  ).toBeInTheDocument();
});
it("prevents two incoming sheets replacing the same target and permits an explicit manual choice", async () => {
  await open();
  fireEvent.change(screen.getByLabelText("Revision destination for Sheet 3"), {
    target: { value: "old" },
  });
  expect(
    screen.getByRole("button", { name: "Confirm 3 drawings" }),
  ).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("cannot both replace");
  fireEvent.change(screen.getByLabelText("Revision destination for Sheet 3"), {
    target: { value: "another" },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Confirm 3 drawings" }),
    ).toBeEnabled(),
  );
  expect(screen.getByText(/Manual match: calibration/)).toBeInTheDocument();
});
