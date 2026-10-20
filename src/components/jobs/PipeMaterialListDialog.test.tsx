import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultPipeSpec, type PipeTakeoff } from "~/lib/pipe-spec";

const mock = vi.hoisted(() => ({
  create: vi.fn(),
  add: vi.fn(),
  sync: vi.fn(),
  offers: vi.fn(),
  save: vi.fn(),
  specs: { company: [] as unknown[], job: [] as unknown[], canEditCompany: true, canEditJob: true },
}));
const parts = {
  pipe: [
    { id: "pipe4", displayName: '4" ABS DWV Pipe', sizeNominal: "4", sizeUnit: "in", bulkUnit: null, individualUnit: null, piecesPerPack: 1 },
    { id: "pipe3", displayName: '3" ABS DWV Pipe', sizeNominal: "3", sizeUnit: "in" },
  ],
  fittings: [
    { id: "ell90", displayName: "ABS 1/4 Bend", sizeLabel: '4"' },
    { id: "ell45", displayName: "ABS 45 Elbow", sizeLabel: '4"' },
  ],
  valves: [{ id: "ball", displayName: '2" Ball Valve' }],
};
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      pipeSpecs: { list: { invalidate: vi.fn() } },
      supplier: { getSupplierPartsByPart: { fetch: mock.offers } },
    }),
    pipeSpecs: {
      list: { useQuery: () => ({ data: mock.specs, isSuccess: true, isLoading: false, error: null }) },
      save: { useMutation: () => ({ mutate: mock.save, isPending: false, error: null }) },
      remove: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
    },
    user: { getMe: { useQuery: () => ({ data: { id: "u1", name: "Tim", email: null } }) } },
    catalogue: {
      searchParts: {
        useQuery: (input: { query?: string; categoryId?: string | null }, options: { enabled: boolean }) => ({
          data: !options.enabled ? undefined : input.query === "pipe" ? parts.pipe : input.query === "valve" ? parts.valves : parts.fittings,
          isLoading: false,
        }),
      },
      getMaterials: { useQuery: () => ({ data: [] }) },
      getCategories: { useQuery: () => ({ data: [] }) },
    },
  },
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("~/hooks/use-job-pricing", () => ({ useJobPricing: () => ({ data: undefined }) }));
vi.mock("~/lib/replicache-material-list", () => ({
  getMaterialListReplicache: () => ({ mutate: { createMaterialList: mock.create, addItem: mock.add } }),
  requestMaterialListReplicacheSync: mock.sync,
}));
import { PipeMaterialListDialog } from "./PipeMaterialListDialog";

const takeoff: PipeTakeoff = {
  system: "SAN",
  runs: [
    { size: { unit: "in", nominal: 4 }, meters: 30 },
    { size: null, meters: 2 },
  ],
  components: [
    { kind: "elbow", name: "90° elbow", size: { unit: "in", nominal: 4 }, count: 1 },
    { kind: "elbow", name: "90° elbow", size: { unit: "in", nominal: 4 }, count: 1 },
    { kind: "valve", name: "Ball valve", size: { unit: "mm", nominal: 50 }, count: 1 },
  ],
  componentsChecked: true,
  partial: false,
  tagCount: 2,
};
const renderDialog = () =>
  render(<PipeMaterialListDialog open onOpenChange={vi.fn()} jobId="00000000-0000-4000-8000-000000000001" sheetName="P-101" takeoff={takeoff} />);

beforeEach(() => {
  vi.clearAllMocks();
  mock.specs.company = [{ system: "SAN", spec: defaultPipeSpec(), revision: 3, updatedAt: new Date() }];
  mock.specs.job = [];
  mock.create.mockResolvedValue(undefined);
  mock.add.mockResolvedValue(undefined);
  mock.offers.mockImplementation(async ({ partDefinitionId }: { partDefinitionId: string }) =>
    partDefinitionId === "pipe4"
      ? [
          { id: "sp-other", supplierId: "s2", supplierSku: "B", lastKnownUnitCost: "9", packSize: null, isPreferred: false, supplier: { id: "s2", name: "Other" } },
          { id: "sp-pref", supplierId: "s1", supplierSku: "A", lastKnownUnitCost: "12.5", packSize: null, isPreferred: true, supplier: { id: "s1", name: "Main" } },
        ]
      : [],
  );
});
afterEach(cleanup);
const valueOf = (label: string) => screen.getByLabelText<HTMLInputElement>(label).value;

it("lists sized pipe in sticks with waste and the drawn fittings, then creates a new list", async () => {
  renderDialog();
  expect(screen.getByText("Using the company standard")).toBeTruthy();
  expect(screen.getByText(/11 × 10 ft sticks/)).toBeTruthy();
  expect(valueOf('Quantity for 4" pipe')).toBe("11");
  expect(valueOf('Part for 4" 90° elbow')).toBe("ell90");
  expect(valueOf('Quantity for 4" 90° elbow')).toBe("2");
  expect(valueOf("Part for 50 mm ball valve")).toBe("ball");

  fireEvent.click(screen.getByRole("button", { name: /Create list \(3\)/ }));
  await waitFor(() => expect(screen.getByText(/Created Sanitary – P-101 with 3 parts/)).toBeTruthy());
  expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Sanitary – P-101" }));
  const listId = (mock.create.mock.calls[0]![0] as { materialListId: string }).materialListId;
  expect(mock.add).toHaveBeenCalledWith(
    expect.objectContaining({ materialListId: listId, partDefinitionId: "pipe4", quantity: 11, supplierPartId: "sp-pref", unitCost: 12.5 }),
  );
  expect(mock.add).toHaveBeenCalledWith(expect.objectContaining({ partDefinitionId: "ell90", quantity: 2, supplierPartId: null }));
  expect(mock.sync).toHaveBeenCalledWith(0, "push-pull");
  expect(screen.getByRole("link", { name: "Open list" }).getAttribute("href")).toBe(`/dashboard/material-lists/${listId}`);
});

it("adds untagged pipe to a chosen size and leaves out unticked lines", async () => {
  renderDialog();
  fireEvent.change(screen.getByLabelText("Size for untagged pipe"), { target: { value: "in:4" } });
  // 32 m × 1.1 = 35.2 m = 115.5 ft → 12 sticks.
  expect(valueOf('Quantity for 4" pipe')).toBe("12");
  fireEvent.click(screen.getByRole("checkbox", { name: /50 mm ball valve/ }));
  fireEvent.click(screen.getByRole("button", { name: /Create list \(2\)/ }));
  await waitFor(() => expect(mock.add).toHaveBeenCalledTimes(2));
  expect(mock.add).not.toHaveBeenCalledWith(expect.objectContaining({ partDefinitionId: "ball" }));
});

it("remembers a part chosen by hand on the standard it came from", () => {
  renderDialog();
  fireEvent.change(screen.getByLabelText('Part for 4" 90° elbow'), { target: { value: "ell45" } });
  fireEvent.click(screen.getByRole("button", { name: "Remember 1 choice" }));
  expect(mock.save).toHaveBeenCalledWith(
    { system: "SAN", jobId: null, spec: { ...defaultPipeSpec(), parts: { "elbow:90° elbow|in:4": "ell45" } }, revision: 3 },
    expect.anything(),
  );
});

it("asks for the system when the selection has none", () => {
  render(<PipeMaterialListDialog open onOpenChange={vi.fn()} jobId="00000000-0000-4000-8000-000000000001" sheetName="P-101" takeoff={{ ...takeoff, system: "" }} />);
  expect(screen.getByText("Choose which system this pipe belongs to.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Pipe system"), { target: { value: "SAN" } });
  expect(screen.getByText(/11 × 10 ft sticks/)).toBeTruthy();
});
