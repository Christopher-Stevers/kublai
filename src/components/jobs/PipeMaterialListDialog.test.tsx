import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { jobSystemRequirementsSchema } from "~/lib/job-systems";
import { defaultPipeSpec, type PipeTakeoff } from "~/lib/pipe-spec";

const mock = vi.hoisted(() => ({
  create: vi.fn(),
  add: vi.fn(),
  sync: vi.fn(),
  offers: vi.fn(),
  save: vi.fn(),
  fetchSpecs: vi.fn(),
  assessedParts: [] as unknown[],
  specs: {
    company: [] as unknown[],
    job: [] as unknown[],
    canEditCompany: true,
    canEditJob: true,
    currentSources: undefined as
      | { documentId: string; versionId: string }[]
      | undefined,
  },
}));
const parts = {
  pipe: [
    {
      id: "pipe4",
      displayName: '4" ABS DWV Pipe',
      sizeNominal: "4",
      sizeUnit: "in",
      bulkUnit: null,
      individualUnit: null,
      piecesPerPack: 1,
    },
    {
      id: "pipe3",
      displayName: '3" ABS DWV Pipe',
      sizeNominal: "3",
      sizeUnit: "in",
    },
  ],
  fittings: [
    { id: "ell90", displayName: "ABS 1/4 Bend", sizeLabel: '4"' },
    { id: "ell45", displayName: "ABS 45 Elbow", sizeLabel: '4"' },
  ],
  valves: [{ id: "ball", displayName: '2" Ball Valve' }],
};
vi.mock("~/trpc/react", () => ({
  api: {
    useQueries: (build: (query: unknown) => unknown[]) =>
      build({
        catalogue: {
          searchParts: () => ({
            data: mock.assessedParts,
            isLoading: false,
            error: null,
          }),
        },
      }),
    useUtils: () => ({
      pipeSpecs: { list: { invalidate: vi.fn(), fetch: mock.fetchSpecs } },
      supplier: { getSupplierPartsByPart: { fetch: mock.offers } },
    }),
    pipeSpecs: {
      list: {
        useQuery: () => ({
          data: mock.specs,
          isSuccess: true,
          isLoading: false,
          error: null,
        }),
      },
      save: {
        useMutation: () => ({
          mutate: mock.save,
          isPending: false,
          error: null,
        }),
      },
      remove: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
      },
    },
    user: {
      getMe: {
        useQuery: () => ({ data: { id: "u1", name: "Tim", email: null } }),
      },
    },
    catalogue: {
      searchParts: {
        useQuery: (
          input: { query?: string; categoryId?: string | null },
          options: { enabled: boolean },
        ) => ({
          data: !options.enabled
            ? undefined
            : input.query === "pipe"
              ? parts.pipe
              : input.query === "valve"
                ? parts.valves
                : parts.fittings,
          isLoading: false,
        }),
      },
      getMaterials: { useQuery: () => ({ data: [] }) },
      getCategories: { useQuery: () => ({ data: [] }) },
    },
  },
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("~/hooks/use-job-pricing", () => ({
  useJobPricing: () => ({ data: undefined }),
}));
vi.mock("~/lib/replicache-material-list", () => ({
  getMaterialListReplicache: () => ({
    mutate: { createMaterialList: mock.create, addItem: mock.add },
  }),
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
    {
      kind: "elbow",
      name: "90° elbow",
      size: { unit: "in", nominal: 4 },
      count: 1,
    },
    {
      kind: "elbow",
      name: "90° elbow",
      size: { unit: "in", nominal: 4 },
      count: 1,
    },
    {
      kind: "valve",
      name: "Ball valve",
      size: { unit: "mm", nominal: 50 },
      count: 1,
    },
  ],
  componentsChecked: true,
  partial: false,
  tagCount: 2,
};
const renderDialog = () =>
  render(
    <PipeMaterialListDialog
      open
      onOpenChange={vi.fn()}
      jobId="00000000-0000-4000-8000-000000000001"
      sheetName="P-101"
      takeoff={takeoff}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mock.specs.company = [
    {
      system: "SAN",
      spec: defaultPipeSpec(),
      revision: 3,
      updatedAt: new Date(),
    },
  ];
  mock.specs.job = [];
  mock.specs.currentSources = undefined;
  mock.fetchSpecs.mockImplementation(async () => mock.specs);
  mock.assessedParts = [];
  mock.create.mockResolvedValue(undefined);
  mock.add.mockResolvedValue(undefined);
  mock.offers.mockImplementation(
    async ({ partDefinitionId }: { partDefinitionId: string }) =>
      partDefinitionId === "pipe4"
        ? [
            {
              id: "sp-other",
              supplierId: "s2",
              supplierSku: "B",
              lastKnownUnitCost: "9",
              packSize: null,
              isPreferred: false,
              supplier: { id: "s2", name: "Other" },
            },
            {
              id: "sp-pref",
              supplierId: "s1",
              supplierSku: "A",
              lastKnownUnitCost: "12.5",
              packSize: null,
              isPreferred: true,
              supplier: { id: "s1", name: "Main" },
            },
          ]
        : [],
  );
});
afterEach(cleanup);
const valueOf = (label: string) =>
  screen.getByLabelText<HTMLInputElement>(label).value;

it("lists sized pipe in sticks with waste and the drawn fittings, then creates a new list", async () => {
  renderDialog();
  expect(screen.getByText("Using the company standard")).toBeTruthy();
  expect(screen.getByText(/11 × 10 ft sticks/)).toBeTruthy();
  expect(valueOf('Quantity for 4" pipe')).toBe("11");
  expect(valueOf('Part for 4" 90° elbow')).toBe("ell90");
  expect(valueOf('Quantity for 4" 90° elbow')).toBe("2");
  expect(valueOf("Part for 50 mm ball valve")).toBe("ball");

  fireEvent.click(screen.getByRole("button", { name: /Create list \(3\)/ }));
  await waitFor(() =>
    expect(
      screen.getByText(/Created Sanitary – P-101 with 3 parts/),
    ).toBeTruthy(),
  );
  expect(mock.create).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Sanitary – P-101" }),
  );
  const listId = (mock.create.mock.calls[0]![0] as { materialListId: string })
    .materialListId;
  expect(mock.add).toHaveBeenCalledWith(
    expect.objectContaining({
      materialListId: listId,
      partDefinitionId: "pipe4",
      quantity: 11,
      supplierPartId: "sp-pref",
      unitCost: 12.5,
    }),
  );
  expect(mock.add).toHaveBeenCalledWith(
    expect.objectContaining({
      partDefinitionId: "ell90",
      quantity: 2,
      supplierPartId: null,
    }),
  );
  expect(mock.sync).toHaveBeenCalledWith(0, "push-pull");
  expect(
    screen.getByRole("link", { name: "Open list" }).getAttribute("href"),
  ).toBe(`/dashboard/material-lists/${listId}`);
});

it("adds untagged pipe to a chosen size and leaves out unticked lines", async () => {
  renderDialog();
  fireEvent.change(screen.getByLabelText("Size for untagged pipe"), {
    target: { value: "in:4" },
  });
  // 32 m × 1.1 = 35.2 m = 115.5 ft → 12 sticks.
  expect(valueOf('Quantity for 4" pipe')).toBe("12");
  fireEvent.click(screen.getByRole("checkbox", { name: /50 mm ball valve/ }));
  fireEvent.click(screen.getByRole("button", { name: /Create list \(2\)/ }));
  await waitFor(() => expect(mock.add).toHaveBeenCalledTimes(2));
  expect(mock.add).not.toHaveBeenCalledWith(
    expect.objectContaining({ partDefinitionId: "ball" }),
  );
});

it("remembers a part chosen by hand on the standard it came from", () => {
  renderDialog();
  fireEvent.change(screen.getByLabelText('Part for 4" 90° elbow'), {
    target: { value: "ell45" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Remember 1 choice" }));
  expect(mock.save).toHaveBeenCalledWith(
    {
      system: "SAN",
      jobId: null,
      spec: {
        ...defaultPipeSpec(),
        parts: { "elbow:90° elbow|in:4": "ell45" },
      },
      revision: 3,
    },
    expect.anything(),
  );
});

it("asks for the system when the selection has none", () => {
  render(
    <PipeMaterialListDialog
      open
      onOpenChange={vi.fn()}
      jobId="00000000-0000-4000-8000-000000000001"
      sheetName="P-101"
      takeoff={{ ...takeoff, system: "" }}
    />,
  );
  expect(
    screen.getByText("Choose which system this pipe belongs to."),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Pipe system"), {
    target: { value: "SAN" },
  });
  expect(screen.getByText(/11 × 10 ft sticks/)).toBeTruthy();
});

const materialCopper = "00000000-0000-4000-8000-000000000021";
const materialSteel = "00000000-0000-4000-8000-000000000022";
const evidence = {
  id: "spec-1",
  documentId: "00000000-0000-4000-8000-000000000031",
  versionId: "00000000-0000-4000-8000-000000000032",
  documentTitle: "Mechanical specifications.pdf",
  page: 7,
  section: "22 11 16",
  quote: "Domestic cold water: copper through 2 inches; steel above 2 inches.",
};
function assessedSpec() {
  return {
    ...defaultPipeSpec(),
    requirements: jobSystemRequirementsSchema.parse({
      systemName: "Domestic cold water",
      applicabilityEvidence: [evidence],
      sourceVersions: [
        { documentId: evidence.documentId, versionId: evidence.versionId },
      ],
      rules: [
        {
          id: "small",
          label: "Copper through 2 inches",
          group: "pipe",
          sizeRange: { max: 2 },
          reviewStatus: "approved",
          evidence: [evidence],
          alternatives: [
            { id: "copper", label: "Copper", materialId: materialCopper },
          ],
        },
        {
          id: "large",
          label: "Steel above 2 inches",
          group: "pipe",
          sizeRange: { min: 2, minInclusive: false },
          reviewStatus: "approved",
          evidence: [evidence],
          alternatives: [
            { id: "steel", label: "Steel", materialId: materialSteel },
          ],
        },
      ],
    }),
  };
}
const sizedRuns = {
  ...takeoff,
  runs: [
    { size: { unit: "in" as const, nominal: 2 }, meters: 3 },
    { size: { unit: "in" as const, nominal: 4 }, meters: 3 },
  ],
  components: [],
};
function renderAssessed(spec = assessedSpec()) {
  mock.specs.job = [
    { system: "DCW", spec, revision: 1, updatedAt: new Date() },
  ];
  mock.specs.currentSources = [
    { documentId: evidence.documentId, versionId: evidence.versionId },
  ];
  mock.assessedParts = [
    {
      id: "copper2",
      displayName: '2" Copper Pipe',
      materialId: materialCopper,
    },
    {
      id: "copper4",
      displayName: '4" Copper Pipe',
      materialId: materialCopper,
    },
    { id: "steel4", displayName: '4" Steel Pipe', materialId: materialSteel },
    { id: "steel2", displayName: '2" Steel Pipe', materialId: materialSteel },
  ];
  render(
    <PipeMaterialListDialog
      open
      onOpenChange={vi.fn()}
      jobId="00000000-0000-4000-8000-000000000001"
      sheetName="P-101"
      takeoff={sizedRuns}
    />,
  );
  fireEvent.change(screen.getByLabelText("Pipe system"), {
    target: { value: "DCW" },
  });
}

it("lets a detected drawing system use the job's assessed system, applying exact threshold rules with evidence", async () => {
  renderAssessed();
  expect(valueOf('Part for 2" pipe')).toBe("copper2");
  expect(valueOf('Part for 4" pipe')).toBe("steel4");
  const sources = screen.getAllByRole("link", {
    name: /Mechanical specifications.pdf/,
  });
  expect(sources[0]?.getAttribute("href")).toContain(evidence.documentId);
  expect(
    screen.getByRole("link", { name: "Review system" }).getAttribute("href"),
  ).toMatch(/\/systems$/);
  fireEvent.click(screen.getByRole("button", { name: "Create list (2)" }));
  await waitFor(() => expect(mock.add).toHaveBeenCalledTimes(2));
  expect(mock.add).toHaveBeenCalledWith(
    expect.objectContaining({ partDefinitionId: "copper2" }),
  );
  expect(mock.add).toHaveBeenCalledWith(
    expect.objectContaining({ partDefinitionId: "steel4" }),
  );
});

it("blocks unreviewed requirements until those lines are explicitly excluded", async () => {
  const spec = assessedSpec();
  spec.requirements.rules[1]!.reviewStatus = "pending";
  renderAssessed(spec);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Create list (1)" })
      .disabled,
  ).toBe(true);
  expect(screen.getByText(/Review “Steel above 2 inches”/)).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: /4" pipe/ }));
  fireEvent.click(screen.getByRole("button", { name: "Create list (1)" }));
  await waitFor(() => expect(mock.add).toHaveBeenCalledTimes(1));
});

it("rejects a saved part outside the required size and material", () => {
  const spec = assessedSpec();
  spec.parts["pipe|in:2"] = "steel4";
  renderAssessed(spec);
  expect(valueOf('Part for 2" pipe')).toBe("copper2");
});

it("requires an explicit part choice when multiple catalogue parts satisfy a requirement", () => {
  renderAssessed();
  mock.assessedParts.push({
    id: "copper2b",
    displayName: '2" Copper Pipe alternate',
    materialId: materialCopper,
  });
  fireEvent.change(screen.getByLabelText("Pipe system"), {
    target: { value: "SAN" },
  });
  fireEvent.change(screen.getByLabelText("Pipe system"), {
    target: { value: "DCW" },
  });
  expect(valueOf('Part for 2" pipe')).toBe("");
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Create list (1)" })
      .disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('Part for 2" pipe'), {
    target: { value: "copper2b" },
  });
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Create list (2)" })
      .disabled,
  ).toBe(false);
});

it("rechecks saved rules before creating a list and stops when their revision changed", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    renderAssessed();
    mock.fetchSpecs.mockResolvedValueOnce({
      ...mock.specs,
      job: [{ system: "DCW", spec: assessedSpec(), revision: 2 }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Create list (2)" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "source documents changed",
      ),
    );
    expect(mock.create).not.toHaveBeenCalled();
    expect(mock.add).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});

it("rechecks source versions before creating a list", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    renderAssessed();
    mock.fetchSpecs.mockResolvedValueOnce({
      ...mock.specs,
      currentSources: [
        {
          documentId: evidence.documentId,
          versionId: "00000000-0000-4000-8000-000000000033",
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Create list (2)" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "source documents changed",
      ),
    );
    expect(mock.create).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});

it("requires confirmation of the second reducer size even when only one catalogue option exists", () => {
  const spec = assessedSpec();
  spec.requirements.rules = [
    { ...spec.requirements.rules[1]!, group: "fittings" },
  ];
  mock.specs.job = [{ system: "DCW", spec, revision: 1 }];
  mock.assessedParts = [
    {
      id: "reducer4x2",
      displayName: '4" x 2" Steel Reducer',
      materialId: materialSteel,
    },
  ];
  render(
    <PipeMaterialListDialog
      open
      onOpenChange={vi.fn()}
      jobId="00000000-0000-4000-8000-000000000001"
      sheetName="P-101"
      takeoff={{
        ...takeoff,
        system: "DCW",
        runs: [],
        components: [
          {
            kind: "reducer",
            name: "Reducer",
            size: { unit: "in", nominal: 4 },
            count: 1,
          },
        ],
      }}
    />,
  );
  expect(screen.getByText(/Confirm both reducer sizes/)).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Create list (0)" })
      .disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('Part for 4" reducer'), {
    target: { value: "reducer4x2" },
  });
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Create list (1)" })
      .disabled,
  ).toBe(false);
});
