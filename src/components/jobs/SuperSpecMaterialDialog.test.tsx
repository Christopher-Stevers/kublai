import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  start: vi.fn(async () => ({})),
  refetch: vi.fn(),
  data: {
    assessment: null,
    documents: [
      { id: "spec", name: "Mechanical specifications", inSpecifications: true },
      { id: "slip", name: "Packing slip", inSpecifications: false },
    ],
    folderId: "folder",
    canAssess: true,
    stale: false,
  },
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ pipeSpecs: { list: { invalidate: vi.fn() } } }),
    pipeSpecs: {
      assessment: {
        useQuery: () => ({ data: state.data, refetch: state.refetch }),
      },
      list: { useQuery: () => ({ data: { job: [] } }) },
      assess: {
        useMutation: () => ({ mutateAsync: state.start, isPending: false }),
      },
      assessSpecMaterials: {
        useMutation: () => ({ mutateAsync: state.start, isPending: false }),
      },
    },
  },
}));
import { SuperSpecMaterialDialog } from "./SuperSpecMaterialDialog";
afterEach(cleanup);
it("lists only specifications and starts a server-selected folder assessment", async () => {
  render(<SuperSpecMaterialDialog jobId="job" onClose={() => {}} />);
  expect(screen.getByText("Mechanical specifications")).toBeInTheDocument();
  expect(screen.queryByText("Packing slip")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Assess all specifications" }),
  );
  await waitFor(() =>
    expect(state.start).toHaveBeenCalledWith({ jobId: "job" }),
  );
});

it("allows an explicit source selection beyond the Specifications folder", async () => {
  render(<SuperSpecMaterialDialog jobId="job" onClose={() => {}} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Choose assessment sources" }),
  );
  fireEvent.click(screen.getByLabelText("Packing slip"));
  fireEvent.click(
    screen.getByRole("button", { name: "Assess selected sources" }),
  );
  await waitFor(() =>
    expect(state.start).toHaveBeenCalledWith({
      jobId: "job",
      selection: { documentIds: ["spec", "slip"], drawingSetIds: [] },
    }),
  );
});
