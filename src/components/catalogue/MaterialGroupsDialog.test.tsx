import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn(), pull: vi.fn() }));
vi.mock("~/lib/replicache-catalogue", () => ({ requestCatalogueReplicachePull: mocks.pull }));
vi.mock("~/trpc/react", () => ({ api: {
  catalogue: {
    getMaterials: { useQuery: () => ({ data: [{ id: "xfr", name: "XFR", groupPath: ["PVC"] }, { id: "copper", name: "Copper", groupPath: [] }] }) },
    setMaterialGroups: { useMutation: () => ({ mutateAsync: mocks.save, isPending: false }) },
  },
  useUtils: () => ({ catalogue: { getMaterials: { invalidate: mocks.refresh }, getPartWizardSummary: { invalidate: mocks.refresh } } }),
} }));
import { MaterialGroupsDialog } from "./MaterialGroupsDialog";
afterEach(cleanup);
beforeEach(() => { mocks.save.mockReset().mockResolvedValue({ updated: 1 }); mocks.pull.mockClear(); });
it("saves only edited materials and refreshes the offline catalogue", async () => {
  const close = vi.fn(); render(<MaterialGroupsDialog open onOpenChange={close} />);
  fireEvent.change(screen.getByLabelText("Group for XFR"), { target: { value: "PVC / Drainage" } });
  fireEvent.click(screen.getByRole("button", { name: "Save groups (1)" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ assignments: [{ materialId: "xfr", groupPath: ["PVC", "Drainage"] }] }));
  await waitFor(() => expect(close).toHaveBeenCalledWith(false)); expect(mocks.pull).toHaveBeenCalledWith(0);
});
it("allows moving a material back to the top level", async () => {
  render(<MaterialGroupsDialog open onOpenChange={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Group for XFR"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save groups (1)" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ assignments: [{ materialId: "xfr", groupPath: [] }] }));
});
it("keeps edits when filtering and blocks malformed nesting before sending", async () => {
  render(<MaterialGroupsDialog open onOpenChange={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Group for XFR"), { target: { value: "PVC // SDR" } });
  fireEvent.change(screen.getByLabelText("Find material to group"), { target: { value: "Copper" } });
  fireEvent.click(screen.getByRole("button", { name: "Save groups (1)" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("XFR"); expect(mocks.save).not.toHaveBeenCalled();
});
it("leaves the editor open and preserves changes when saving fails", async () => {
  mocks.save.mockRejectedValue(new Error("Connection interrupted"));
  const close = vi.fn(); render(<MaterialGroupsDialog open onOpenChange={close} />);
  fireEvent.change(screen.getByLabelText("Group for Copper"), { target: { value: "Metals" } });
  fireEvent.click(screen.getByRole("button", { name: "Save groups (1)" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted"); expect(close).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Group for Copper")).toHaveValue("Metals");
});
