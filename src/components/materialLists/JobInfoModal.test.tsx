import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  update: vi.fn(() => Promise.resolve()),
  sync: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    materialList: {
      getMaterialList: { useQuery: () => ({ data: { job: { id: "job" } } }) },
    },
  },
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("~/hooks/use-workspace-mutations", () => ({
  useWorkspaceMutations: () => ({
    getReplicache: () => ({ mutate: { updateJob: state.update } }),
    mutateAndSync: state.sync,
  }),
}));
vi.mock("~/components/ui/LocationSelector", () => ({
  LocationSelector: ({
    value,
    onChange,
  }: {
    value: string | null;
    onChange: (value: null) => void;
  }) => (
    <button onClick={() => onChange(null)}>Location: {value ?? "none"}</button>
  ),
}));
import { JobInfoModal } from "./JobInfoModal";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("preserves a deliberate clear through refresh, and resets on reopening", () => {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    materialListId: "list",
    initialName: "Job",
    initialLocationId: "original",
  };
  const view = render(<JobInfoModal {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Location: original" }));
  view.rerender(<JobInfoModal {...props} initialName="Refreshed job" />);
  expect(
    screen.getByRole("button", { name: "Location: none" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save & Continue" }));
  expect(state.update).toHaveBeenCalledWith({
    jobId: "job",
    name: "Job",
    locationId: null,
  });
  view.rerender(<JobInfoModal {...props} open={false} />);
  view.rerender(<JobInfoModal {...props} />);
  expect(
    screen.getByRole("button", { name: "Location: original" }),
  ).toBeInTheDocument();
});
